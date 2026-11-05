import "server-only";
import { randomUUID } from "node:crypto";
import tls from "node:tls";
import { db } from "../db";
import type { Monitor } from "../opsTypes";

/** Uptime monitors: HTTP status + latency every minute, plus TLS certificate expiry. */

interface MonitorRow {
  id: string;
  project_id: string | null;
  name: string;
  url: string;
  created_at: number;
}
interface CheckRow {
  at: number;
  ok: number;
  status: number | null;
  ms: number | null;
  error: string | null;
  tls_days_left: number | null;
}

function hydrate(m: MonitorRow): Monitor {
  const checks = db().prepare("SELECT * FROM monitor_checks WHERE monitor_id = ? ORDER BY at DESC LIMIT 60").all(m.id) as CheckRow[];
  const day = db().prepare("SELECT COUNT(*) AS n, SUM(ok) AS up FROM monitor_checks WHERE monitor_id = ? AND at > ?").get(m.id, Date.now() - 86_400_000) as { n: number; up: number | null };
  const last = checks[0];
  return {
    ...m,
    last: last ? { at: last.at, ok: !!last.ok, status: last.status, ms: last.ms, error: last.error, tlsDaysLeft: last.tls_days_left } : null,
    uptime24h: day.n ? Math.round(((day.up ?? 0) / day.n) * 10000) / 100 : null,
    history: checks.reverse().map((c) => ({ at: c.at, ok: !!c.ok, ms: c.ms })),
  };
}

export function listMonitors(projectId?: string | null): Monitor[] {
  ensureScheduler();
  const rows = (projectId
    ? db().prepare("SELECT * FROM monitors WHERE project_id = ? OR project_id IS NULL ORDER BY created_at").all(projectId)
    : db().prepare("SELECT * FROM monitors ORDER BY created_at").all()) as MonitorRow[];
  return rows.map(hydrate);
}

export function getMonitor(id: string): Monitor | undefined {
  const r = db().prepare("SELECT * FROM monitors WHERE id = ?").get(id) as MonitorRow | undefined;
  return r ? hydrate(r) : undefined;
}

export async function createMonitor(i: { projectId?: string | null; name: string; url: string }): Promise<Monitor> {
  const u = new URL(i.url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs");
  const m: MonitorRow = { id: randomUUID(), project_id: i.projectId ?? null, name: i.name, url: u.toString(), created_at: Date.now() };
  db().prepare("INSERT INTO monitors (id, project_id, name, url, created_at) VALUES (@id, @project_id, @name, @url, @created_at)").run(m);
  await checkMonitor(m.id);
  return getMonitor(m.id)!;
}

export function deleteMonitor(id: string) {
  db().prepare("DELETE FROM monitors WHERE id = ?").run(id);
}

function tlsDaysLeft(url: URL): Promise<number | null> {
  if (url.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const t = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
      resolve(Number.isFinite(t) ? Math.floor((t - Date.now()) / 86_400_000) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export async function checkMonitor(id: string): Promise<Monitor | undefined> {
  const m = db().prepare("SELECT * FROM monitors WHERE id = ?").get(id) as MonitorRow | undefined;
  if (!m) return undefined;
  const url = new URL(m.url);
  const t0 = performance.now();
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "REX-Uptime/1.0" } });
    status = res.status;
    await res.body?.cancel();
  } catch (e) {
    error = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out after 15s" : e.message) : String(e);
  }
  const ms = Math.round(performance.now() - t0);
  const days = await tlsDaysLeft(url);
  const ok = status !== null && status < 400;
  db()
    .prepare("INSERT INTO monitor_checks (monitor_id, at, ok, status, ms, error, tls_days_left) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, Date.now(), ok ? 1 : 0, status, error ? null : ms, error ?? (ok ? null : `HTTP ${status}`), days);
  // Keep ~2 days of history per monitor.
  db().prepare("DELETE FROM monitor_checks WHERE monitor_id = ? AND at < ?").run(id, Date.now() - 2 * 86_400_000);
  return getMonitor(id);
}

const g = globalThis as unknown as { __rexMonitorTimer?: ReturnType<typeof setInterval> };

/** Background checks every minute while the REX server runs. */
export function ensureScheduler() {
  if (g.__rexMonitorTimer) return;
  g.__rexMonitorTimer = setInterval(() => {
    const ids = (db().prepare("SELECT id FROM monitors").all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) void checkMonitor(id).catch(() => {});
  }, 60_000);
  g.__rexMonitorTimer.unref?.();
}

import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../db";
import type { Server, ServerWithLast, Snapshot, SshHost } from "../opsTypes";
import { errorOf, findBin, run } from "./exec";
import { parseAccessLog } from "./traffic";

/**
 * SSH servers. REX uses your ssh keys / agent / ~/.ssh/config (BatchMode: it
 * never asks for or stores passwords) and runs one fixed, read-only script per
 * snapshot: health, who's logged in, connections, processes, failed services,
 * containers, and the web server's access log for traffic analysis.
 */

export const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}$/;
export const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/i;
export const LOG_RE = /^\/[A-Za-z0-9_./-]{1,250}$/;

type Row = Server & { last_snapshot: string | null };

const withLast = (r: Row): ServerWithLast => {
  const { last_snapshot, ...s } = r;
  let last: Snapshot | null = null;
  try {
    last = last_snapshot ? (JSON.parse(last_snapshot) as Snapshot) : null;
  } catch {
    /* corrupt snapshot */
  }
  return { ...s, last };
};

export function listServers(projectId?: string | null): ServerWithLast[] {
  const rows = (projectId
    ? db().prepare("SELECT * FROM servers WHERE project_id = ? OR project_id IS NULL ORDER BY created_at").all(projectId)
    : db().prepare("SELECT * FROM servers ORDER BY created_at").all()) as Row[];
  return rows.map(withLast);
}

export function getServer(id: string): ServerWithLast | undefined {
  const r = db().prepare("SELECT * FROM servers WHERE id = ?").get(id) as Row | undefined;
  return r ? withLast(r) : undefined;
}

export interface ServerInput {
  projectId?: string | null;
  name: string;
  host: string;
  user?: string | null;
  port?: number | null;
  identityFile?: string | null;
  logPath?: string | null;
}

export function createServer(i: ServerInput): Server {
  const s: Server = {
    id: randomUUID(),
    project_id: i.projectId ?? null,
    name: i.name,
    host: i.host,
    user: i.user || null,
    port: i.port || 22,
    identity_file: i.identityFile || null,
    log_path: i.logPath || null,
    created_at: Date.now(),
  };
  db().prepare("INSERT INTO servers (id, project_id, name, host, user, port, identity_file, log_path, created_at) VALUES (@id, @project_id, @name, @host, @user, @port, @identity_file, @log_path, @created_at)").run(s);
  return s;
}

export function updateServer(id: string, i: Partial<ServerInput>) {
  const cur = getServer(id);
  if (!cur) return undefined;
  db()
    .prepare("UPDATE servers SET name = ?, host = ?, user = ?, port = ?, identity_file = ?, log_path = ? WHERE id = ?")
    .run(i.name ?? cur.name, i.host ?? cur.host, i.user !== undefined ? i.user || null : cur.user, i.port ?? cur.port, i.identityFile !== undefined ? i.identityFile || null : cur.identity_file, i.logPath !== undefined ? i.logPath || null : cur.log_path, id);
  return getServer(id);
}

export function deleteServer(id: string) {
  db().prepare("DELETE FROM servers WHERE id = ?").run(id);
}

/** Hosts from ~/.ssh/config (wildcards skipped). */
export function sshConfigHosts(): SshHost[] {
  let text = "";
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(os.homedir(), ".ssh", "config"), "utf8");
  } catch {
    return [];
  }
  const out: SshHost[] = [];
  let cur: SshHost[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [k, ...rest] = line.split(/\s+/);
    const v = rest.join(" ");
    const key = k.toLowerCase();
    if (key === "host") {
      cur = v.split(/\s+/).filter((a) => !/[*?!]/.test(a)).map((alias) => ({ alias, hostname: null, user: null, port: null }));
      out.push(...cur);
    } else if (key === "hostname") cur.forEach((h) => (h.hostname = v));
    else if (key === "user") cur.forEach((h) => (h.user = v));
    else if (key === "port") cur.forEach((h) => (h.port = Number(v) || null));
  }
  return out;
}

/** ssh argv for a server (no remote command). */
export function sshArgs(s: Server): string[] {
  if (!HOST_RE.test(s.host) || (s.user && !USER_RE.test(s.user))) throw new Error("Invalid host or user");
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=5"];
  // Default port is left to ~/.ssh/config (an alias may set Port / ProxyJump / IdentityFile).
  if (s.port && s.port !== 22) args.push("-p", String(s.port));
  if (s.identity_file) args.push("-i", s.identity_file);
  args.push(s.user ? `${s.user}@${s.host}` : s.host);
  return args;
}

/** Shell line for an interactive SSH session in the integrated terminal (prompts allowed: no BatchMode). */
export function sshCommandLine(s: Server): string {
  const q = (a: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const args = sshArgs(s);
  const i = args.indexOf("BatchMode=yes");
  if (i > 0) args.splice(i - 1, 2);
  return ["ssh", ...args].map(q).join(" ");
}

/** Runs a fixed command over ssh (used by Docker-on-server). */
export async function sshExec(s: Server, remote: string, timeout = 30_000) {
  const bin = findBin(["ssh"]) ?? "ssh";
  return run(bin, [...sshArgs(s), remote], { timeout });
}

const SECTIONS = ["HOST", "UPTIME", "LOAD", "CPUS", "MEM", "DISK", "WHO", "LAST", "ESTAB", "LISTEN", "PS", "FAILED", "DOCKER", "LOG"] as const;

function snapshotScript(logPath: string | null): string {
  const log = logPath && LOG_RE.test(logPath) ? logPath : "/var/log/nginx/access.log";
  return [
    "export LC_ALL=C",
    'echo "===HOST==="; hostname; ( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) || uname -s; uname -r',
    'echo "===UPTIME==="; cut -d" " -f1 /proc/uptime 2>/dev/null',
    'echo "===LOAD==="; cat /proc/loadavg 2>/dev/null',
    'echo "===CPUS==="; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN',
    'echo "===MEM==="; free -m 2>/dev/null',
    'echo "===DISK==="; df -Pk -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null || df -Pk',
    'echo "===WHO==="; who 2>/dev/null',
    'echo "===LAST==="; last -n 10 -w 2>/dev/null | head -n 10',
    'echo "===ESTAB==="; ss -Htn state established 2>/dev/null | awk \'{print $4}\'',
    'echo "===LISTEN==="; ss -Htlnp 2>/dev/null || ss -Htln 2>/dev/null',
    'echo "===PS==="; ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -n 16',
    'echo "===FAILED==="; systemctl --failed --no-legend --plain 2>/dev/null | awk \'{print $1}\'',
    "echo \"===DOCKER===\"; docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo __nodocker__",
    `echo "===LOG==="; tail -n 20000 '${log}' 2>/dev/null || sudo -n tail -n 20000 '${log}' 2>/dev/null || echo __nolog__`,
  ].join("\n");
}

function splitSections(out: string): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of out.split("\n")) {
    const m = line.match(/^===([A-Z]+)===$/);
    if (m && (SECTIONS as readonly string[]).includes(m[1])) {
      cur = m[1];
      res[cur] = [];
    } else if (cur) res[cur].push(line);
  }
  return res;
}

const num = (v: string | undefined) => (v === undefined ? 0 : Number(v) || 0);

export function parseSnapshot(out: string, logPath: string | null, ms: number): Snapshot {
  const s = splitSections(out);
  const host = (s.HOST ?? []).filter(Boolean);
  const load = (s.LOAD?.[0] ?? "").split(/\s+/).slice(0, 3).map(Number) as [number, number, number];
  const memLine = (s.MEM ?? []).find((l) => l.startsWith("Mem:"))?.split(/\s+/) ?? [];
  const swapLine = (s.MEM ?? []).find((l) => l.startsWith("Swap:"))?.split(/\s+/) ?? [];
  const disks = (s.DISK ?? [])
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 6 && /^\d+$/.test(p[1]))
    .map((p) => ({ fs: p[0], mount: p[5], sizeGb: +(num(p[1]) / 1048576).toFixed(1), usedGb: +(num(p[2]) / 1048576).toFixed(1), pct: num(p[4].replace("%", "")) }))
    .filter((d) => d.sizeGb > 0.2);

  const peers = (s.ESTAB ?? []).map((l) => l.trim()).filter(Boolean);
  const byIp = new Map<string, number>();
  for (const p of peers) {
    const ip = p.replace(/^\[?(.*?)\]?:\d+$/, "$1").replace(/^::ffff:/, "");
    byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
  }
  const listening = (s.LISTEN ?? [])
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 4)
    .map((p) => {
      const local = p[3];
      const port = Number(local.slice(local.lastIndexOf(":") + 1)) || 0;
      const proc = (p.slice(5).join(" ").match(/\("([^"]+)"/) ?? [])[1] ?? "";
      return { addr: local.slice(0, local.lastIndexOf(":")), port, process: proc };
    })
    .filter((l, i, a) => l.port && a.findIndex((x) => x.port === l.port && x.process === l.process) === i)
    .sort((a, b) => a.port - b.port);

  const docker = s.DOCKER?.includes("__nodocker__")
    ? { available: false, containers: [] }
    : {
        available: true,
        containers: (s.DOCKER ?? []).filter(Boolean).map((l) => {
          const [name, image, status, ports] = l.split("\t");
          return { name: name ?? "", image: image ?? "", status: status ?? "", ports: ports ?? "" };
        }),
      };

  const logLines = s.LOG ?? [];
  const traffic = logLines.includes("__nolog__") || !logLines.filter(Boolean).length ? null : parseAccessLog(logLines, logPath || "/var/log/nginx/access.log");

  return {
    at: Date.now(),
    ok: true,
    ms,
    system: {
      hostname: host[0] ?? "",
      os: host[1] ?? "",
      kernel: host[2] ?? "",
      uptimeSec: Math.round(num(s.UPTIME?.[0])),
      load: [load[0] || 0, load[1] || 0, load[2] || 0],
      cpus: num(s.CPUS?.[0]) || 1,
      mem: { totalMb: num(memLine[1]), usedMb: num(memLine[2]), availableMb: num(memLine[6] ?? memLine[3]) },
      swap: { totalMb: num(swapLine[1]), usedMb: num(swapLine[2]) },
      disks,
    },
    users: (s.WHO ?? []).filter(Boolean).map((l) => {
      const p = l.trim().split(/\s+/);
      const from = (l.match(/\(([^)]+)\)/) ?? [])[1] ?? "local";
      return { user: p[0], tty: p[1] ?? "", from, since: p.slice(2, 4).join(" ") };
    }),
    lastLogins: (s.LAST ?? [])
      .filter((l) => l.trim() && !/^(wtmp|reboot)/.test(l))
      .map((l) => {
        const p = l.trim().split(/\s+/);
        return { user: p[0], from: /^\d|:/.test(p[2] ?? "") ? p[2] : "local", when: p.slice(3, 7).join(" ") };
      }),
    connections: { established: peers.length, byIp: [...byIp].map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count).slice(0, 15), listening },
    processes: (s.PS ?? [])
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 5)
      .map((p) => ({ pid: num(p[0]), user: p[1], cpu: num(p[2]), mem: num(p[3]), cmd: p.slice(4).join(" ") })),
    failedServices: (s.FAILED ?? []).map((l) => l.trim()).filter(Boolean),
    docker,
    traffic,
  };
}

export async function takeSnapshot(s: Server): Promise<Snapshot> {
  const t0 = Date.now();
  const r = await sshExec(s, snapshotScript(s.log_path), 45_000);
  const ms = Date.now() - t0;
  const snap: Snapshot = r.ok || r.stdout.includes("===HOST===") ? parseSnapshot(r.stdout, s.log_path, ms) : { at: Date.now(), ok: false, ms, error: errorOf(r, "SSH failed") };
  db().prepare("UPDATE servers SET last_snapshot = ? WHERE id = ?").run(JSON.stringify(snap), s.id);
  return snap;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, Globe, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { Monitor } from "@/lib/opsTypes";
import type { Project } from "@/lib/types";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { confirmDialog } from "@/components/ui/dialog";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { Card, ErrorBox, Pill, Sentence, Sparkline, Spinner, errMsg, friendlyError, useOpsFetch, type OpsNav, type Tone } from "./shared";

const normUrl = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

export function tlsTone(days: number | null): Tone | null {
  if (days == null) return null;
  return days < 3 ? "err" : days < 14 ? "warn" : "ok";
}

/**
 * `project` overrides the active project (the Project hub shows any project);
 * `addIntent` (any new truthy value) focuses the add form, prefilled with the project website.
 */
export default function UptimeSection({ nav, project: projectProp, addIntent }: { nav: OpsNav; project?: Project | null; addIntent?: number }) {
  const active = useActiveProject();
  const project = projectProp !== undefined ? projectProp : active;
  const urlInput = useRef<HTMLInputElement>(null);
  const log = useWorkbench((s) => s.log);
  const url = `/api/ops/monitors${nav.projectId ? `?projectId=${encodeURIComponent(nav.projectId)}` : ""}`;
  const { data: list, error, setData, reload } = useOpsFetch<Monitor[]>(url, nav.reloadKey);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Checks run server-side every minute; follow along.
  useEffect(() => {
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const ready = !!list;
  const site0 = project?.website_url?.trim() ?? "";
  useEffect(() => {
    if (!addIntent || !ready) return;
    if (site0) setTarget((t) => t || site0);
    requestAnimationFrame(() => {
      urlInput.current?.scrollIntoView({ block: "center" });
      urlInput.current?.focus();
    });
  }, [addIntent, ready, site0]);

  const add = async (n: string, u: string) => {
    let href = u.trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    setAdding(true);
    try {
      const m = await api<Monitor>("/api/ops/monitors", { method: "POST", json: { projectId: nav.projectId, name: n.trim() || new URL(href).hostname, url: href } });
      setData((l) => [...(l ?? []), m]);
      setName("");
      setTarget("");
      log("ok", "ops", `Monitoring ${m.url}`);
    } catch (e) {
      log("error", "ops", errMsg(e));
    } finally {
      setAdding(false);
    }
  };

  const check = async (m: Monitor) => {
    setBusy(m.id);
    try {
      const next = await api<Monitor>(`/api/ops/monitors/${m.id}/check`, { method: "POST" });
      setData((l) => (l ?? []).map((x) => (x.id === m.id ? next : x)));
    } catch (e) {
      log("error", "ops", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: Monitor) => {
    if (!(await confirmDialog({ title: `Delete monitor ${m.name}?`, message: `Stops checking ${m.url} and deletes its history.`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api(`/api/ops/monitors/${m.id}`, { method: "DELETE" });
      setData((l) => (l ?? []).filter((x) => x.id !== m.id));
    } catch (e) {
      log("error", "ops", errMsg(e));
    }
  };

  if (!list && error) return <ErrorBox title="Couldn't load monitors" error={error} onRetry={() => void reload()} />;
  if (!list)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-[62px] !rounded-[6px]" />
        <Skeleton className="h-[180px] !rounded-[6px]" />
      </div>
    );

  const site = project?.website_url?.trim();
  const siteMonitored = !!site && list.some((m) => normUrl(m.url) === normUrl(/^https?:\/\//i.test(site) ? site : `https://${site}`));

  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add(name, target);
        }}
        aria-label="Add monitor"
      >
        <label className="field w-40">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Website" />
        </label>
        <label className="field min-w-[200px] flex-1">
          <span className="label">URL</span>
          <input ref={urlInput} className="input font-mono" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://example.com/health" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={adding || !target.trim()}>
          {adding ? <Spinner /> : <Plus size={12} />} Add monitor
        </button>
        {site && !siteMonitored && (
          <button type="button" className="btn" disabled={adding} onClick={() => void add(project?.name ? `${project.name} website` : "Website", site)}>
            <Globe size={12} /> Add project website
          </button>
        )}
        <p className="help !mt-0 w-full">Checked once a minute in the background: status, latency and TLS expiry.</p>
      </form>

      {!list.length ? (
        <Card>
          <EmptyState
            icon={Activity}
            title="No monitors yet"
            hint="Add your website, API health endpoint or anything public. Downtime shows here and in Issues."
            action={site ? { label: "Monitor project website", icon: Globe, onClick: () => void add(project?.name ? `${project.name} website` : "Website", site) } : { label: "Add monitor", icon: Plus, onClick: () => urlInput.current?.focus() }}
          />
        </Card>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden" aria-label="Monitors">
          {list.map((m) => {
            const l = m.last;
            const tls = tlsTone(l?.tlsDaysLeft ?? null);
            const statusTone: Tone = !l ? "muted" : l.ok ? "ok" : "err";
            return (
              <li key={m.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Pill tone={statusTone}>{!l ? "Pending" : l.ok ? "Up" : "Down"}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium" title={m.name}>
                      {m.name}
                    </div>
                    <a href={m.url} target="_blank" rel="noreferrer" title={m.url} className="block truncate font-mono text-[11.5px] text-muted hover:text-accent hover:underline">
                      {m.url}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums text-muted">
                    <span title="Last HTTP status">{l?.status ?? "—"}</span>
                    <span title="Latency">{l?.ms != null ? `${l.ms} ms` : "—"}</span>
                    {tls && (
                      <span className="flex items-center gap-1" style={{ color: `var(--${tls})` }} title="TLS certificate expires in">
                        <Lock size={11} /> {l?.tlsDaysLeft}d
                      </span>
                    )}
                    <span title="Uptime, last 24h" className={m.uptime24h != null && m.uptime24h < 99 ? "text-warn" : ""}>
                      {m.uptime24h != null ? `${m.uptime24h.toFixed(2)}%` : "—"} <span className="text-faint">24h</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button className="icon-btn" onClick={() => void check(m)} disabled={busy === m.id} aria-label={`Check ${m.name} now`} title="Check now">
                      {busy === m.id ? <Spinner /> : <RefreshCw size={13} />}
                    </button>
                    <button className="icon-btn hover:!text-err" onClick={() => void remove(m)} aria-label={`Delete ${m.name}`} title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <Sparkline points={m.history.slice(-60).map((h) => ({ ok: h.ok, v: h.ms }))} label={`Latency history for ${m.name}, ${m.history.filter((h) => !h.ok).length} failed checks`} />
                </div>
                {l && (
                  <div className="mt-1 flex gap-2 text-[11px] text-faint">
                    <span className="shrink-0">Checked {timeAgo(l.at)}</span>
                    {l.error && (
                      <span className="min-w-0 flex-1 truncate text-err" title={l.error}>
                        <Sentence text={friendlyError(l.error).text} />
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

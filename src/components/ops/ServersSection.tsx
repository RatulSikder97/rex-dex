"use client";
import { useEffect, useMemo, useState } from "react";
import { Cpu, HardDrive, Pencil, Plus, RefreshCw, Server as ServerIcon, Stethoscope, Terminal, Trash2, Users, Network, ListTree, OctagonX, Boxes, X } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { Server, ServerWithLast, Snapshot, SshHost } from "@/lib/opsTypes";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { confirmDialog } from "@/components/ui/dialog";
import { useWorkbench } from "@/store/workbench";
import { Card, Dot, ErrorBox, LoadingGrid, Meter, Pill, Spinner, Stat, Table, errMsg, fmtMb, fmtUptime, handOff, ipHint, pct, useOpsFetch, type OpsNav } from "./shared";
import { serverHealth } from "./OverviewSection";

const DEFAULT_LOG = "/var/log/nginx/access.log";

export function serversUrl(projectId: string | null) {
  return `/api/ops/servers${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`;
}

/** Plain-text digest of a snapshot for an agent (keeps the important numbers, drops noise). */
export function summarizeSnapshot(s: Server, l: Snapshot | null): string {
  const L = [`Server ${s.name} — ${s.user ? `${s.user}@` : ""}${s.host}:${s.port}`];
  if (!l) return [...L, "No snapshot taken yet."].join("\n");
  L.push(`Snapshot ${new Date(l.at).toISOString()} (${l.ms} ms) ok=${l.ok}`);
  if (!l.ok) return [...L, `Error: ${l.error ?? "unknown"}`].join("\n");
  const y = l.system;
  if (y) {
    L.push(`Host ${y.hostname}, ${y.os}, kernel ${y.kernel}, up ${fmtUptime(y.uptimeSec)}`);
    L.push(`Load ${y.load.join(" / ")} on ${y.cpus} CPUs`);
    L.push(`Memory ${fmtMb(y.mem.usedMb)} / ${fmtMb(y.mem.totalMb)} used (${fmtMb(y.mem.availableMb)} available); swap ${fmtMb(y.swap.usedMb)} / ${fmtMb(y.swap.totalMb)}`);
    for (const d of y.disks) L.push(`Disk ${d.mount} (${d.fs}) ${d.usedGb}/${d.sizeGb} GB = ${d.pct}%`);
  }
  if (l.failedServices?.length) L.push(`FAILED systemd services: ${l.failedServices.join(", ")}`);
  if (l.users?.length) L.push(`Logged in: ${l.users.map((u) => `${u.user}@${u.from || u.tty}`).join(", ")}`);
  if (l.lastLogins?.length) L.push(`Recent logins: ${l.lastLogins.slice(0, 8).map((u) => `${u.user} from ${u.from} ${u.when}`).join("; ")}`);
  if (l.connections) {
    L.push(`Established connections: ${l.connections.established}`);
    L.push(`Top remote IPs: ${l.connections.byIp.slice(0, 10).map((x) => `${x.ip}×${x.count}`).join(", ")}`);
    L.push(`Listening: ${l.connections.listening.map((x) => `${x.addr}:${x.port} ${x.process}`).join(", ")}`);
  }
  if (l.processes?.length) {
    L.push("Top processes (cpu% mem% user cmd):");
    for (const p of l.processes.slice(0, 10)) L.push(`  ${p.cpu} ${p.mem} ${p.user} ${p.cmd.slice(0, 120)}`);
  }
  if (l.docker?.available) L.push(`Docker containers: ${l.docker.containers.map((c) => `${c.name} (${c.status})`).join(", ") || "none"}`);
  if (l.traffic) {
    const t = l.traffic;
    L.push(`Traffic (${t.source}, ${t.lines} lines): 2xx ${t.status["2xx"]}, 3xx ${t.status["3xx"]}, 4xx ${t.status["4xx"]}, 5xx ${t.status["5xx"]}`);
    L.push(`Top paths: ${t.topPaths.slice(0, 8).map((x) => `${x.path}×${x.count}`).join(", ")}`);
    L.push(`Bots: AI ${t.bots.ai}, search ${t.bots.search}, other ${t.bots.other}, human ${t.bots.human}`);
  }
  return L.join("\n");
}

/** `addIntent` (any new truthy value) opens the Add server form — used by the Project hub. */
export default function ServersSection({ nav, addIntent }: { nav: OpsNav; addIntent?: number }) {
  const { data: list, error, setData, reload } = useOpsFetch<ServerWithLast[]>(serversUrl(nav.projectId), nav.reloadKey);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; server: Server } | null>(null);
  useEffect(() => {
    if (addIntent) setForm({ mode: "add" });
  }, [addIntent]);
  const selected = list?.find((s) => s.id === nav.serverId) ?? list?.[0] ?? null;

  if (!list && error) return <ErrorBox title="Couldn't load servers" error={error} onRetry={() => void reload()} />;
  if (!list)
    return (
      <div className="space-y-3">
        <Skeleton className="h-[86px] !rounded-[6px]" />
        <LoadingGrid n={2} />
      </div>
    );

  const onSaved = (s: Server) => {
    setForm(null);
    setData((l) => {
      const cur = l ?? [];
      const prev = cur.find((x) => x.id === s.id);
      return prev ? cur.map((x) => (x.id === s.id ? { ...x, ...s } : x)) : [...cur, { ...s, last: null }];
    });
    nav.setServerId(s.id);
  };

  return (
    <div className="space-y-4">
      {(!!list.length || form) && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[12px] text-muted">
            {list.length ? `${list.length} ${list.length === 1 ? "server" : "servers"} · read over SSH with your existing keys` : "Read over SSH with your existing keys"}
          </p>
          {!form && (
            <button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: "add" })}>
              <Plus size={12} aria-hidden /> Add server
            </button>
          )}
        </div>
      )}

      {form && <ServerForm key={form.mode === "edit" ? form.server.id : "add"} projectId={nav.projectId} initial={form.mode === "edit" ? form.server : null} onCancel={() => setForm(null)} onSaved={onSaved} />}

      {!list.length && !form && (
        <Card>
          <EmptyState icon={ServerIcon} title="No servers yet" hint="Add a VPS or any SSH host. REX reads health, sessions, connections and the access log, read-only, with your existing keys." action={{ label: "Add server", icon: Plus, onClick: () => setForm({ mode: "add" }) }} />
        </Card>
      )}

      {!!list.length && (
        <div className="card overflow-hidden py-1" role="listbox" aria-label="Servers">
          {list.map((s) => {
            const h = serverHealth(s);
            const on = selected?.id === s.id;
            const addr = `${s.user ? `${s.user}@` : ""}${s.host}${s.port !== 22 ? `:${s.port}` : ""}`;
            return (
              <button key={s.id} role="option" aria-selected={on} onClick={() => nav.setServerId(s.id)} className="row h-7 w-full text-left">
                <Dot tone={h.tone} label={h.label} />
                <span className="min-w-0 shrink truncate font-medium" title={s.name}>
                  {s.name}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={addr}>
                  {addr}
                </span>
                <span className="shrink-0 text-[11px] text-faint">{h.label}</span>
                <span className="w-20 shrink-0 text-right text-[11px] text-faint">{s.last ? timeAgo(s.last.at) : "No snapshot"}</span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ServerDetail
          key={selected.id}
          server={selected}
          onSnapshot={(snap) => setData((l) => (l ?? []).map((x) => (x.id === selected.id ? { ...x, last: snap } : x)))}
          onEdit={() => setForm({ mode: "edit", server: selected })}
          onDeleted={() => {
            nav.setServerId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ServerForm({ projectId, initial, onCancel, onSaved }: { projectId: string | null; initial: Server | null; onCancel: () => void; onSaved: (s: Server) => void }) {
  const log = useWorkbench((s) => s.log);
  const { data: hosts } = useOpsFetch<SshHost[]>("/api/ops/ssh-hosts");
  const [f, setF] = useState({
    name: initial?.name ?? "",
    host: initial?.host ?? "",
    user: initial?.user ?? "",
    port: String(initial?.port ?? 22),
    identityFile: initial?.identity_file ?? "",
    logPath: initial?.log_path ?? DEFAULT_LOG,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const pick = (alias: string) => {
    const h = hosts?.find((x) => x.alias === alias);
    if (!h) return;
    // Using the alias as host lets ssh apply the rest of ~/.ssh/config (ProxyJump, IdentityFile…).
    setF((p) => ({ ...p, name: p.name || h.alias, host: h.alias, user: h.user ?? p.user, port: String(h.port ?? 22) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.host.trim()) return;
    setBusy(true);
    try {
      const json = {
        projectId,
        name: f.name.trim(),
        host: f.host.trim(),
        user: f.user.trim() || null,
        port: Number(f.port) || 22,
        identityFile: f.identityFile.trim() || null,
        logPath: f.logPath.trim() || null,
      };
      const s = initial ? await api<Server>(`/api/ops/servers/${initial.id}`, { method: "PATCH", json }) : await api<Server>("/api/ops/servers", { method: "POST", json });
      log("ok", "ops", initial ? `Saved ${s.name}` : `Added ${s.name} — take a snapshot to see its health`);
      onSaved(s);
    } catch (err) {
      log("error", "ops", errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "field";
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="card"
      aria-label={initial ? "Edit server" : "Add server"}
    >
      <div className="card-head">
        <h3 className="min-w-0 flex-1 truncate">{initial ? `Edit ${initial.name}` : "Add server"}</h3>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel" title="Cancel (Esc)">
          <X size={13} />
        </button>
      </div>
      <div className="card-body space-y-3">
      {!!hosts?.length && (
        <label className={field}>
          <span className="label">From ~/.ssh/config</span>
          <select className="input" defaultValue="" onChange={(e) => pick(e.target.value)}>
            <option value="" disabled>
              Pick a host…
            </option>
            {hosts.map((h) => (
              <option key={h.alias} value={h.alias}>
                {h.alias}
                {h.hostname ? ` — ${h.user ? `${h.user}@` : ""}${h.hostname}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        <label className={field}>
          <span className="label">Name</span>
          <input className="input" required value={f.name} onChange={set("name")} placeholder="prod-web-1" />
        </label>
        <label className={field}>
          <span className="label">Host</span>
          <input className="input font-mono" required value={f.host} onChange={set("host")} placeholder="203.0.113.10 or ssh alias" />
        </label>
        <label className={field}>
          <span className="label">User</span>
          <input className="input font-mono" value={f.user} onChange={set("user")} placeholder="ubuntu" />
        </label>
        <label className={field}>
          <span className="label">Port</span>
          <input className="input font-mono" inputMode="numeric" value={f.port} onChange={set("port")} />
        </label>
        <label className={field}>
          <span className="label">Identity file</span>
          <input className="input font-mono" value={f.identityFile} onChange={set("identityFile")} placeholder="~/.ssh/id_ed25519" />
          <span className="help">Optional. Leave empty to use ssh-agent.</span>
        </label>
        <label className={field}>
          <span className="label">Access log</span>
          <input className="input font-mono" value={f.logPath} onChange={set("logPath")} placeholder={DEFAULT_LOG} />
          <span className="help">Optional. Used for traffic (nginx / Apache combined format).</span>
        </label>
      </div>
      <p className="help">REX uses key-based SSH with no password prompts: your key must be in ssh-agent or set above, and the host must already be in known_hosts.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !f.name.trim() || !f.host.trim()}>
          {busy && <Spinner />} {initial ? "Save" : "Add server"}
        </button>
      </div>
      </div>
    </form>
  );
}

/** Snapshot-taking state with an elapsed-seconds counter (snapshots take ~5–15 s). */
function useElapsed(active: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    setS(0);
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return s;
}

function ServerDetail({ server, onSnapshot, onEdit, onDeleted }: { server: ServerWithLast; onSnapshot: (s: Snapshot) => void; onEdit: () => void; onDeleted: () => void }) {
  const log = useWorkbench((s) => s.log);
  const [busy, setBusy] = useState(false);
  const elapsed = useElapsed(busy);
  const l = server.last;

  const snapshot = async () => {
    setBusy(true);
    try {
      const snap = await api<Snapshot>(`/api/ops/servers/${server.id}/snapshot`, { method: "POST" });
      onSnapshot(snap);
      if (!snap.ok) log("error", "ops", `${server.name}: ${snap.error ?? "snapshot failed"}`);
    } catch (e) {
      log("error", "ops", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${server.name}?`, message: "Removes the server and its snapshots from REX. Nothing on the server changes.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api(`/api/ops/servers/${server.id}`, { method: "DELETE" });
      log("ok", "ops", `Deleted ${server.name}`);
      onDeleted();
    } catch (e) {
      log("error", "ops", errMsg(e));
    }
  };

  const ssh = () => {
    const s = useWorkbench.getState();
    s.launchSsh(server.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="min-w-[200px] flex-1">
          <h3 className="section-h truncate" title={server.name}>
            {server.name}
          </h3>
          <div className="truncate text-[12px] text-muted">
            {l ? `Snapshot ${timeAgo(l.at)} · took ${(l.ms / 1000).toFixed(1)}s` : "No snapshot yet"}
            {server.log_path ? ` · log ${server.log_path}` : ""}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => void snapshot()} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw size={12} />} {busy ? `Snapshotting… ${elapsed}s` : "Refresh snapshot"}
        </button>
        <button className="btn btn-sm" onClick={ssh}>
          <Terminal size={12} /> SSH terminal
        </button>
        <button className="btn btn-sm" onClick={() => handOff("qa", `Diagnose server ${server.name} (${server.host}). Find problems, rank by severity, and give exact fix commands.`, summarizeSnapshot(server, l))}>
          <Stethoscope size={12} /> Diagnose
        </button>
        <button className="icon-btn" onClick={onEdit} aria-label="Edit server" title="Edit server">
          <Pencil size={13} />
        </button>
        <button className="icon-btn hover:!text-err" onClick={() => void remove()} aria-label="Delete server" title="Delete server">
          <Trash2 size={13} />
        </button>
      </div>
      {busy && (
        <div className="h-1 overflow-hidden rounded-[2px] bg-hover" role="progressbar" aria-label="Taking snapshot">
          <div className="h-full rounded-[2px] bg-accent transition-[width] duration-1000" style={{ width: `${Math.min(95, (elapsed / 15) * 100)}%` }} />
        </div>
      )}

      {!l && !busy && (
        <Card>
          <EmptyState compact icon={RefreshCw} title="No snapshot yet" hint="Take one to read system health, sessions, connections, processes and traffic over SSH." action={{ label: "Take snapshot", onClick: () => void snapshot() }} />
        </Card>
      )}
      {l && !l.ok && !busy && <SshError error={l.error} onRetry={() => void snapshot()} />}
      {l?.ok && <SnapshotPanels snap={l} />}
    </div>
  );
}

function SshError({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <ErrorBox title="Couldn't reach the server over SSH" error={error ?? "Unknown error"} onRetry={onRetry}>
      <span className="text-faint">REX signs in with SSH keys only (no password prompts). Check the host, port and user, and that a firewall allows your IP.</span>
    </ErrorBox>
  );
}

function SnapshotPanels({ snap }: { snap: Snapshot }) {
  const y = snap.system;
  const conns = snap.connections;
  const procs = useMemo(() => [...(snap.processes ?? [])].sort((a, b) => b.cpu - a.cpu).slice(0, 12), [snap.processes]);
  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      {y && (
        <Card title="System" icon={<Cpu size={13} />} className="@4xl:col-span-2">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <Stat label="Hostname" value={<span className="text-[13px]" title={y.hostname}>{y.hostname}</span>} sub={`${y.os} · ${y.kernel}`} />
            <Stat label="Uptime" value={fmtUptime(y.uptimeSec)} />
            <Stat label={`Load (1/5/15) · ${y.cpus} CPU`} value={y.load.map((x) => x.toFixed(2)).join(" ")} tone={y.load[0] > y.cpus * 1.5 ? "err" : y.load[0] > y.cpus ? "warn" : undefined} sub={`${pct(y.load[0], y.cpus)}% of CPUs`} />
            <Stat label="Memory" value={`${pct(y.mem.usedMb, y.mem.totalMb)}%`} sub={`${fmtMb(y.mem.usedMb)} of ${fmtMb(y.mem.totalMb)} · ${fmtMb(y.mem.availableMb)} free`} />
          </div>
          <div className="mt-3 space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-[11.5px] text-muted">
                <span>Memory</span>
                <span className="tabular-nums">{fmtMb(y.mem.usedMb)} / {fmtMb(y.mem.totalMb)}</span>
              </div>
              <Meter value={pct(y.mem.usedMb, y.mem.totalMb)} label="Memory used" />
            </div>
            {y.swap.totalMb > 0 && (
              <div>
                <div className="mb-1 flex justify-between text-[11.5px] text-muted">
                  <span>Swap</span>
                  <span className="tabular-nums">{fmtMb(y.swap.usedMb)} / {fmtMb(y.swap.totalMb)}</span>
                </div>
                <Meter value={pct(y.swap.usedMb, y.swap.totalMb)} warn={50} err={80} label="Swap used" />
              </div>
            )}
            {y.disks.map((d) => (
              <div key={`${d.fs}${d.mount}`}>
                <div className="mb-1 flex justify-between gap-2 text-[11.5px] text-muted">
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    <HardDrive size={11} /> <span className="font-mono">{d.mount}</span> <span className="truncate text-faint">{d.fs}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${d.pct >= 90 ? "font-medium text-err" : ""}`}>
                    {d.usedGb} / {d.sizeGb} GB · {d.pct}%
                  </span>
                </div>
                <Meter value={d.pct} label={`Disk ${d.mount}`} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {!!snap.failedServices?.length && (
        <Card title="Failed services" icon={<OctagonX size={13} className="text-err" />} className="@4xl:col-span-2 !border-[color-mix(in_srgb,var(--err)_40%,var(--border))]">
          <div className="flex flex-wrap gap-1.5">
            {snap.failedServices.map((s) => (
              <Pill key={s} tone="err">
                {s}
              </Pill>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11.5px] text-muted">systemctl status {snap.failedServices[0]} · journalctl -u {snap.failedServices[0]} -n 100</p>
        </Card>
      )}

      <Card title="Logged-in users" icon={<Users size={13} />} action={<span className="count">{snap.users?.length ?? 0}</span>}>
        {snap.users?.length ? (
          <Table label="Logged-in users" head={["User", "TTY", "From", "Since"]}>
            {snap.users.map((u, i) => (
              <tr key={i}>
                <td className="font-medium">{u.user}</td>
                <td className="font-mono text-muted">{u.tty}</td>
                <td className="font-mono">{u.from || "local"}</td>
                <td className="text-muted">{u.since}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[12px] text-muted">Nobody is logged in right now.</p>
        )}
        {!!snap.lastLogins?.length && (
          <>
            <div className="section-title mb-1.5 mt-3">Last logins</div>
            <ul className="space-y-0.5 text-[12px]">
              {snap.lastLogins.slice(0, 10).map((u, i) => (
                <li key={i} className="flex h-6 items-center gap-2">
                  <span className="w-24 shrink-0 truncate font-medium">{u.user}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{u.from}</span>
                  <span className="shrink-0 text-muted">{u.when}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Connections" icon={<Network size={13} />}>
        {conns ? (
          <>
            <Stat label="Established" value={conns.established} />
            <div className="section-title mb-1.5 mt-3">Top remote IPs</div>
            {conns.byIp.length ? (
              <ul className="space-y-0.5 text-[12px]">
                {conns.byIp.slice(0, 8).map((c) => {
                  const hint = ipHint(c.ip);
                  return (
                    <li key={c.ip} className="flex h-6 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{c.ip}</span>
                      {hint && <Pill tone="muted">{hint}</Pill>}
                      <span className="tabular-nums text-muted">{c.count}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-faint">No remote connections.</p>
            )}
            <div className="section-title mb-1.5 mt-3">Listening ports</div>
            <div className="flex flex-wrap gap-1.5">
              {conns.listening.map((p, i) => (
                <span key={i} className="pill font-mono" title={`${p.addr}:${p.port}`}>
                  <span className="text-fg">:{p.port}</span> {p.process || "?"}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[12px] text-muted">Connection data unavailable (needs ss or netstat).</p>
        )}
      </Card>

      <Card title="Top processes" icon={<ListTree size={13} />} className="@4xl:col-span-2" flush={!!procs.length}>
        {procs.length ? (
          <Table label="Top processes" head={["PID", "User", "CPU %", "Mem %", "Command"]}>
            {procs.map((p) => (
              <tr key={p.pid}>
                <td className="font-mono text-muted">{p.pid}</td>
                <td>{p.user}</td>
                <td className={`tabular-nums ${p.cpu >= 80 ? "text-err" : p.cpu >= 40 ? "text-warn" : ""}`}>{p.cpu.toFixed(1)}</td>
                <td className={`tabular-nums ${p.mem >= 40 ? "text-warn" : ""}`}>{p.mem.toFixed(1)}</td>
                <td className="max-w-[420px] truncate font-mono text-[11.5px]" title={p.cmd}>
                  {p.cmd}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[12px] text-muted">No process data in this snapshot.</p>
        )}
      </Card>

      {snap.docker && (
        <Card title="Docker on host" icon={<Boxes size={13} />} className="@4xl:col-span-2" flush={!!snap.docker.available && !!snap.docker.containers.length}>
          {!snap.docker.available ? (
            <p className="text-[12px] text-muted">Docker isn&apos;t installed or the user can&apos;t reach the daemon.</p>
          ) : snap.docker.containers.length ? (
            <Table label="Containers on host" head={["Name", "Image", "Status", "Ports"]}>
              {snap.docker.containers.map((c) => (
                <tr key={c.name}>
                  <td className="font-medium">{c.name}</td>
                  <td className="max-w-[220px] truncate font-mono text-[11.5px] text-muted" title={c.image}>
                    {c.image}
                  </td>
                  <td>
                    <Pill tone={/^up/i.test(c.status) ? (/unhealthy/i.test(c.status) ? "warn" : "ok") : "err"}>{c.status}</Pill>
                  </td>
                  <td className="max-w-[240px] truncate font-mono text-[11px] text-muted" title={c.ports}>
                    {c.ports}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="text-[12px] text-muted">No containers.</p>
          )}
        </Card>
      )}
    </div>
  );
}

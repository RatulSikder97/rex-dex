"use client";
import { Activity, AlertOctagon, AlertTriangle, Boxes, CircleCheckBig, ExternalLink, GitBranch, Server as ServerIcon, Ship, Stethoscope } from "lucide-react";
import { timeAgo } from "@/lib/client";
import type { OpsOverview, ServerWithLast } from "@/lib/opsTypes";
import { EmptyState } from "@/components/ui/empty";
import { useActiveProject } from "@/store/workbench";
import { Card, Dot, ErrorBox, LoadingGrid, Pill, handOff, pct, useOpsFetch, type OpsNav, type Tone, asSection } from "./shared";
import { runTone } from "./GitSection";

export function serverHealth(s: ServerWithLast): { tone: Tone; label: string } {
  const l = s.last;
  if (!l) return { tone: "muted", label: "No snapshot yet" };
  if (!l.ok) return { tone: "err", label: "Unreachable" };
  const sys = l.system;
  const disk = Math.max(0, ...(sys?.disks.map((d) => d.pct) ?? [0]));
  const overloaded = sys ? sys.load[0] > sys.cpus * 1.5 : false;
  if (disk >= 90 || overloaded || (l.failedServices?.length ?? 0) > 0) return { tone: "err", label: "Problems" };
  const mem = sys ? pct(sys.mem.usedMb, sys.mem.totalMb) : 0;
  if (disk >= 80 || mem >= 90 || (sys && sys.load[0] > sys.cpus)) return { tone: "warn", label: "Under pressure" };
  return { tone: "ok", label: "Healthy" };
}

/** Compact plain-text snapshot of everything on the overview, for the QA / DevOps agent. */
function summarize(o: OpsOverview, project: string): string {
  const L: string[] = [`Ops snapshot for ${project} at ${new Date().toISOString()}`];
  if (o.problems.length) {
    L.push("", "PROBLEMS:");
    for (const p of o.problems) L.push(`- [${p.severity}] ${p.title} — ${p.detail} (${p.section})`);
  } else L.push("", "PROBLEMS: none detected automatically");
  const g = o.git;
  L.push("", "GIT:");
  if (!g) L.push("- no repository");
  else {
    L.push(`- branch ${g.branch ?? "(detached)"}, ahead ${g.ahead}, behind ${g.behind}`);
    for (const r of g.remotes) L.push(`- remote ${r.name}: ${r.url}`);
    const run = g.gh.runs[0];
    if (run) L.push(`- latest CI: ${run.name} on ${run.branch}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`);
    if (g.gh.available) L.push(`- open PRs ${g.gh.prs.length}, open issues ${g.gh.issues.length}`);
  }
  L.push("", "SERVERS:");
  if (!o.servers.length) L.push("- none configured");
  for (const s of o.servers) {
    const l = s.last;
    if (!l) {
      L.push(`- ${s.name} (${s.user ? `${s.user}@` : ""}${s.host}:${s.port}): no snapshot`);
      continue;
    }
    if (!l.ok) {
      L.push(`- ${s.name} (${s.host}): UNREACHABLE — ${l.error ?? "unknown error"}`);
      continue;
    }
    const sys = l.system;
    const parts = [`${s.name} (${s.host})`];
    if (sys) {
      parts.push(`load ${sys.load.join("/")} on ${sys.cpus} cpus`, `mem ${pct(sys.mem.usedMb, sys.mem.totalMb)}%`);
      parts.push(`disks ${sys.disks.map((d) => `${d.mount} ${d.pct}%`).join(", ")}`);
    }
    if (l.connections) parts.push(`${l.connections.established} established conns`);
    if (l.failedServices?.length) parts.push(`FAILED services: ${l.failedServices.join(", ")}`);
    if (l.traffic) parts.push(`traffic ${l.traffic.lines} req, 5xx ${l.traffic.status["5xx"]}, 4xx ${l.traffic.status["4xx"]}`);
    parts.push(`snapshot ${timeAgo(l.at)}`);
    L.push(`- ${parts.join("; ")}`);
  }
  L.push("", "UPTIME MONITORS:");
  if (!o.monitors.length) L.push("- none");
  for (const m of o.monitors) {
    const l = m.last;
    L.push(`- ${m.name} ${m.url}: ${l ? (l.ok ? "UP" : "DOWN") : "unchecked"}${l?.status ? ` HTTP ${l.status}` : ""}${l?.ms != null ? ` ${l.ms}ms` : ""}${l?.tlsDaysLeft != null ? ` TLS ${l.tlsDaysLeft}d` : ""}${m.uptime24h != null ? ` uptime24h ${m.uptime24h.toFixed(2)}%` : ""}${l?.error ? ` error: ${l.error}` : ""}`);
  }
  L.push("", `DOCKER (this Mac): ${o.docker.available ? `${o.docker.running}/${o.docker.total} running` : `unavailable${o.docker.error ? ` — ${o.docker.error}` : ""}`}`);
  L.push(`KUBERNETES: ${o.k8s.available ? `context ${o.k8s.context ?? "?"}, pods ${o.k8s.podsRunning}/${o.k8s.podsTotal} running, ${o.k8s.podsFailing} failing` : `unavailable${o.k8s.error ? ` — ${o.k8s.error}` : ""}`}`);
  return L.join("\n");
}

export default function OverviewSection({ nav }: { nav: OpsNav }) {
  const project = useActiveProject();
  const url = `/api/ops/overview${nav.projectId ? `?projectId=${encodeURIComponent(nav.projectId)}` : ""}`;
  const { data: o, error, loading } = useOpsFetch<OpsOverview>(url, nav.reloadKey);

  if (!o && error) return <ErrorBox title="Couldn't load the ops overview">{error}</ErrorBox>;
  if (!o) return <LoadingGrid n={6} />;

  const name = project?.name ?? "this workspace";
  const diagnose = () =>
    handOff("qa", `Review this ops snapshot for ${name}. Find problems, rank by severity, and give exact fix commands.`, summarize(o, name));
  const g = o.git;
  const run = g?.gh.runs[0];
  const web = g?.remotes.find((r) => r.webUrl)?.webUrl ?? null;
  const up = o.monitors.filter((m) => m.last?.ok).length;
  const down = o.monitors.filter((m) => m.last && !m.last.ok).length;
  const errors = o.problems.filter((p) => p.severity === "error").length;

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-elev/30 p-3.5">
        <span className={errors ? "text-err" : o.problems.length ? "text-warn" : "text-ok"}>{o.problems.length ? <AlertTriangle size={18} /> : <CircleCheckBig size={18} />}</span>
        <div className="min-w-[200px] flex-1">
          <div className="text-[13.5px] font-semibold">{o.problems.length ? `${o.problems.length} ${o.problems.length === 1 ? "problem needs" : "problems need"} attention` : "Everything looks healthy"}</div>
          <div className="text-[12px] text-muted">Hand the full snapshot to QA &amp; DevOps for a ranked review with fix commands.</div>
        </div>
        <button className="btn btn-primary h-8" onClick={diagnose}>
          <Stethoscope size={13} /> Diagnose with QA &amp; DevOps
        </button>
      </div>

      {!!o.problems.length && (
        <ul className="space-y-1.5" aria-label="Problems">
          {o.problems.map((p, i) => (
            <li key={i}>
              <button
                className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-elev/20 px-3 py-2 text-left hover:bg-elev/50"
                onClick={() => nav.go(asSection(p.section))}
              >
                {p.severity === "error" ? <AlertOctagon size={14} className="mt-0.5 shrink-0 text-err" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium">{p.title}</span>
                  <span className="block break-words text-[11.5px] text-muted">{p.detail}</span>
                </span>
                <span className="shrink-0 text-[11px] text-faint">{p.section}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Card title="Git" icon={<GitBranch size={14} />} onClick={() => nav.go("git")} action={web ? <ExternalLink size={12} className="text-faint" /> : undefined}>
          {!g ? (
            <p className="text-[12px] text-muted">No git repository for this project.</p>
          ) : (
            <div className="space-y-1.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-medium">{g.branch ?? "detached HEAD"}</span>
                {g.ahead > 0 && <Pill tone="accent">↑{g.ahead} ahead</Pill>}
                {g.behind > 0 && <Pill tone="warn">↓{g.behind} behind</Pill>}
                {!g.ahead && !g.behind && <Pill tone="muted">in sync</Pill>}
              </div>
              {web && (
                <a href={web} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block truncate text-accent hover:underline">
                  {web.replace(/^https?:\/\//, "")}
                </a>
              )}
              <div className="flex items-center gap-2 text-muted">
                CI:{" "}
                {run ? (
                  <>
                    <Pill tone={runTone(run)}>{run.conclusion ?? run.status}</Pill>
                    <span className="truncate">{run.name}</span>
                  </>
                ) : (
                  <span className="text-faint">{g.gh.available ? "no runs" : "gh not set up"}</span>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title={`Servers${o.servers.length ? ` · ${o.servers.length}` : ""}`} icon={<ServerIcon size={14} />} onClick={() => nav.go("servers")}>
          {!o.servers.length ? (
            <p className="text-[12px] text-muted">No servers yet. Add one over SSH to see health, who&apos;s logged in and traffic.</p>
          ) : (
            <ul className="space-y-2">
              {o.servers.slice(0, 5).map((s) => {
                const h = serverHealth(s);
                const sys = s.last?.system;
                const disk = sys ? Math.max(0, ...sys.disks.map((d) => d.pct)) : null;
                return (
                  <li key={s.id} className="text-[12px]">
                    <div className="flex items-center gap-2">
                      <Dot tone={h.tone} label={h.label} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">{s.last ? timeAgo(s.last.at) : "never"}</span>
                    </div>
                    {sys ? (
                      <div className="ml-4 mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted">
                        <span>load {sys.load[0].toFixed(2)}/{sys.cpus}</span>
                        <span>mem {pct(sys.mem.usedMb, sys.mem.totalMb)}%</span>
                        <span className={disk != null && disk >= 90 ? "text-err" : ""}>disk {disk}%</span>
                        {s.last?.connections && <span>{s.last.connections.established} conns</span>}
                      </div>
                    ) : (
                      <div className="ml-4 mt-0.5 truncate text-[11.5px] text-muted">{s.last?.error ?? h.label}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`Uptime${o.monitors.length ? ` · ${up}/${o.monitors.length} up` : ""}`} icon={<Activity size={14} />} onClick={() => nav.go("uptime")}>
          {!o.monitors.length ? (
            <p className="text-[12px] text-muted">No monitors. Add your website to get checked every minute.</p>
          ) : (
            <ul className="space-y-1.5">
              {o.monitors.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[12px]">
                  <Dot tone={!m.last ? "muted" : m.last.ok ? "ok" : "err"} label={!m.last ? "Not checked" : m.last.ok ? "Up" : "Down"} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{m.last?.ms != null ? `${m.last.ms} ms` : "—"}</span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-faint">{m.uptime24h != null ? `${m.uptime24h.toFixed(1)}%` : ""}</span>
                </li>
              ))}
              {down > 0 && <li className="text-[11.5px] font-medium text-err">{down} down</li>}
            </ul>
          )}
        </Card>

        <Card title="Docker" icon={<Boxes size={14} />} onClick={() => nav.go("docker")}>
          {o.docker.available ? (
            <div className="text-[12px]">
              <span className="text-[17px] font-semibold tabular-nums">{o.docker.running}</span>
              <span className="text-muted"> / {o.docker.total} containers running on this Mac</span>
            </div>
          ) : (
            <p className="text-[12px] text-muted">{o.docker.error ?? "Docker isn't available on this Mac."}</p>
          )}
        </Card>

        <Card title="Kubernetes" icon={<Ship size={14} />} onClick={() => nav.go("k8s")}>
          {o.k8s.available ? (
            <div className="space-y-1 text-[12px]">
              <div className="truncate font-mono text-[11.5px] text-muted">{o.k8s.context ?? "no context"}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  <b className="text-[17px] tabular-nums">{o.k8s.podsRunning}</b>
                  <span className="text-muted"> / {o.k8s.podsTotal} pods running</span>
                </span>
                {o.k8s.podsFailing > 0 && <Pill tone="err">{o.k8s.podsFailing} failing</Pill>}
              </div>
            </div>
          ) : (
            <p className="break-words text-[12px] text-muted">{o.k8s.error ?? "kubectl isn't available or no cluster is configured."}</p>
          )}
        </Card>
      </div>
      {!o.servers.length && !o.monitors.length && !g && (
        <EmptyState icon={ServerIcon} title="Nothing to watch yet" hint="Add a server or an uptime monitor to start." action={{ label: "Add server", onClick: () => nav.go("servers") }} secondary={{ label: "Add monitor", onClick: () => nav.go("uptime") }} />
      )}
    </div>
  );
}

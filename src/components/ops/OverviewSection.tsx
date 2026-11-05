"use client";
import { Activity, AlertOctagon, AlertTriangle, Boxes, CircleCheckBig, ExternalLink, GitBranch, Server as ServerIcon, Ship, Stethoscope } from "lucide-react";
import { timeAgo } from "@/lib/client";
import type { OpsOverview, OpsSection, ServerWithLast } from "@/lib/opsTypes";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { useActiveProject } from "@/store/workbench";
import { Card, Dot, ErrorBox, LoadingGrid, Pill, Sentence, friendlyError, handOff, pct, useOpsFetch, type OpsNav, type Tone, asSection } from "./shared";
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
  const { data: o, error, loading, reload } = useOpsFetch<OpsOverview>(url, nav.reloadKey);

  if (!o && error) return <ErrorBox title="Couldn't load the ops overview" error={error} onRetry={() => void reload()} />;
  if (!o)
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 !rounded-[6px]" />
        <LoadingGrid n={4} h="h-36" />
      </div>
    );

  const name = project?.name ?? "this workspace";
  const diagnose = () =>
    handOff("qa", `Review this ops snapshot for ${name}. Find problems, rank by severity, and give exact fix commands.`, summarize(o, name));
  const g = o.git;
  const run = g?.gh.runs[0];
  const web = g?.remotes.find((r) => r.webUrl)?.webUrl ?? null;
  const up = o.monitors.filter((m) => m.last?.ok).length;
  const down = o.monitors.filter((m) => m.last && !m.last.ok).length;
  const errors = o.problems.filter((p) => p.severity === "error").length;
  const nothing = !o.servers.length && !o.monitors.length && !g;

  const srvTones = o.servers.map((s) => serverHealth(s).tone);
  const srvPill: { tone: Tone; label: string } = !o.servers.length
    ? { tone: "muted", label: "None" }
    : srvTones.includes("err")
      ? { tone: "err", label: "Problems" }
      : srvTones.includes("warn")
        ? { tone: "warn", label: "Under pressure" }
        : srvTones.every((t) => t === "muted")
          ? { tone: "muted", label: "No snapshots" }
          : { tone: "ok", label: "Healthy" };
  const docker = o.docker.available ? null : friendlyError(o.docker.error, "Docker isn't available on this Mac.");
  const k8s = o.k8s.available ? null : friendlyError(o.k8s.error, "kubectl isn't available or no cluster is configured.");

  return (
    <div className="space-y-4" aria-busy={loading}>
      <section className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" aria-label="Status">
        <span className={errors ? "text-err" : o.problems.length ? "text-warn" : "text-ok"} aria-hidden>
          {o.problems.length ? <AlertTriangle size={16} /> : <CircleCheckBig size={16} />}
        </span>
        <div className="min-w-[180px] flex-1">
          <div className="text-[13px] font-semibold">{o.problems.length ? `${o.problems.length} ${o.problems.length === 1 ? "problem needs" : "problems need"} attention` : "Everything looks healthy"}</div>
          <div className="text-[12px] text-muted">Hand the full snapshot to QA &amp; DevOps for a ranked review with fix commands.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={diagnose}>
          <Stethoscope size={12} aria-hidden /> Diagnose with QA &amp; DevOps
        </button>
      </section>

      {!!o.problems.length && (
        <Card title="Problems" icon={<AlertTriangle size={13} />} action={<span className="count">{o.problems.length}</span>} flush>
          <ul aria-label="Problems" className="py-1">
            {o.problems.map((p, i) => {
              const f = friendlyError(p.detail, "");
              return (
                <li key={i}>
                  <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => nav.go(asSection(p.section))} title={f.raw ?? p.detail}>
                    {p.severity === "error" ? <AlertOctagon size={13} className="mt-0.5 shrink-0 text-err" aria-label="Error" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-label="Warning" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{p.title}</span>
                      {f.text && (
                        <span className="block truncate text-[12px] text-muted">
                          <Sentence text={f.text} />
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 shrink-0 text-[11px] text-faint">{SECTION_LABEL[asSection(p.section)]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {nothing ? (
        <Card>
          <EmptyState icon={ServerIcon} title="Nothing to watch yet" hint="Add a server to see health and traffic, or a monitor to check your site every minute." action={{ label: "Add server", onClick: () => nav.go("servers") }} secondary={{ label: "Add monitor", onClick: () => nav.go("uptime") }} />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Card
          title="Git"
          icon={<GitBranch size={13} />}
          onClick={() => nav.go("git")}
          action={!g ? <Pill tone="muted">No repository</Pill> : g.behind > 0 ? <Pill tone="warn">{g.behind} behind</Pill> : g.ahead > 0 ? <Pill tone="accent">{g.ahead} ahead</Pill> : <Pill tone="ok">In sync</Pill>}
        >
          {!g ? (
            <p className="text-[12px] text-muted">No git repository for this project.</p>
          ) : (
            <div className="space-y-1.5 text-[12px]">
              <div className="flex min-w-0 items-center gap-2">
                <GitBranch size={12} className="shrink-0 text-faint" aria-hidden />
                <span className="truncate font-mono text-[12px]">{g.branch ?? "detached HEAD"}</span>
              </div>
              {web && (
                <a href={web} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-1 text-accent hover:underline" title={web}>
                  <span className="truncate">{web.replace(/^https?:\/\//, "")}</span>
                  <ExternalLink size={11} className="shrink-0" aria-hidden />
                </a>
              )}
              <div className="flex min-w-0 items-center gap-2 text-muted">
                <span className="shrink-0">CI</span>
                {run ? (
                  <>
                    <Pill tone={runTone(run)}>{run.conclusion ?? run.status}</Pill>
                    <span className="truncate" title={run.name}>
                      {run.name}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">{g.gh.available ? "No runs" : "GitHub CLI not set up"}</span>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Servers" icon={<ServerIcon size={13} />} onClick={() => nav.go("servers")} action={<Pill tone={srvPill.tone}>{o.servers.length ? `${o.servers.length} · ${srvPill.label}` : srvPill.label}</Pill>}>
          {!o.servers.length ? (
            <p className="text-[12px] text-muted">Add one over SSH to see health, who&apos;s logged in and traffic.</p>
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
                      <span className="min-w-0 flex-1 truncate font-medium" title={s.name}>
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">{s.last ? timeAgo(s.last.at) : "Never"}</span>
                    </div>
                    {sys ? (
                      <div className="ml-3.5 mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted">
                        <span>load {sys.load[0].toFixed(2)}/{sys.cpus}</span>
                        <span>mem {pct(sys.mem.usedMb, sys.mem.totalMb)}%</span>
                        <span className={disk != null && disk >= 90 ? "text-err" : ""}>disk {disk}%</span>
                        {s.last?.connections && <span>{s.last.connections.established} conns</span>}
                      </div>
                    ) : (
                      <div className="ml-3.5 mt-0.5 truncate text-[11.5px] text-muted" title={s.last?.error ?? undefined}>
                        {s.last?.error ? <Sentence text={friendlyError(s.last.error).text} /> : h.label}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Uptime"
          icon={<Activity size={13} />}
          onClick={() => nav.go("uptime")}
          action={!o.monitors.length ? <Pill tone="muted">None</Pill> : down ? <Pill tone="err">{down} down</Pill> : <Pill tone={up ? "ok" : "muted"}>{up}/{o.monitors.length} up</Pill>}
        >
          {!o.monitors.length ? (
            <p className="text-[12px] text-muted">Add your website to get it checked every minute.</p>
          ) : (
            <ul className="space-y-1.5">
              {o.monitors.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[12px]">
                  <Dot tone={!m.last ? "muted" : m.last.ok ? "ok" : "err"} label={!m.last ? "Not checked" : m.last.ok ? "Up" : "Down"} />
                  <span className="min-w-0 flex-1 truncate" title={m.url}>
                    {m.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{m.last?.ms != null ? `${m.last.ms} ms` : "—"}</span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-faint">{m.uptime24h != null ? `${m.uptime24h.toFixed(1)}%` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Docker" icon={<Boxes size={13} />} onClick={() => nav.go("docker")} action={o.docker.available ? <Pill tone={o.docker.running ? "ok" : "muted"}>{o.docker.running} running</Pill> : <Pill tone="warn">Not running</Pill>}>
          {o.docker.available ? (
            <div className="text-[12px]">
              <span className="text-[15px] font-semibold tabular-nums">{o.docker.running}</span>
              <span className="text-muted"> of {o.docker.total} containers running on this Mac</span>
            </div>
          ) : (
            <p className="text-[12px] text-muted" title={docker?.raw ?? undefined}>
              <Sentence text={docker!.text} />
            </p>
          )}
        </Card>

        <Card
          title="Kubernetes"
          icon={<Ship size={13} />}
          onClick={() => nav.go("k8s")}
          action={o.k8s.available ? <Pill tone={o.k8s.podsFailing ? "err" : "ok"}>{o.k8s.podsFailing ? `${o.k8s.podsFailing} failing` : "Healthy"}</Pill> : <Pill tone="muted">Not set up</Pill>}
        >
          {o.k8s.available ? (
            <div className="space-y-1 text-[12px]">
              <div className="truncate font-mono text-[11.5px] text-muted" title={o.k8s.context ?? undefined}>
                {o.k8s.context ?? "No context"}
              </div>
              <div>
                <span className="text-[15px] font-semibold tabular-nums">{o.k8s.podsRunning}</span>
                <span className="text-muted"> of {o.k8s.podsTotal} pods running</span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted" title={k8s?.raw ?? undefined}>
              <Sentence text={k8s!.text} />
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

const SECTION_LABEL: Record<OpsSection, string> = { overview: "Overview", servers: "Servers", traffic: "Traffic", docker: "Docker", k8s: "Kubernetes", uptime: "Uptime", git: "Git" };

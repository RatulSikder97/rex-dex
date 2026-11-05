"use client";
import { useEffect, useState } from "react";
import { Bot, FolderPlus, Plus, Rocket, Settings2, Terminal } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { STAGES, type Run } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { stageColor } from "@/components/workbench/SideBar";
import { newProjectFlow, openFolderFlow, showActivity, switchProject } from "@/components/workbench/actions";
import { useAgents, useDepartments, useWorkbench } from "@/store/workbench";

interface Stats {
  byStage: { stage: string; n: number }[];
  openByDept: { department: string; n: number }[];
  taskTotals: { status: string; n: number }[];
  runs7d: number;
  deliverables: number;
  recentRuns: Run[];
}

export default function Dashboard() {
  const { departments, getDepartment } = useDepartments();
  const { agents, label, defaultAgent } = useAgents();
  const { projects, projectId, version, openTab, delegate, openSettings, projectsLoaded } = useWorkbench();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Stats>("/api/dashboard")
      .then((s) => (setStats(s), setFailed(false)))
      .catch(() => setFailed(true));
  }, [version]);

  const loading = !stats && !failed;
  const total = (s: string) => stats?.taskTotals.find((t) => t.status === s)?.n ?? 0;
  const allTasks = stats?.taskTotals.reduce((a, b) => a + b.n, 0) ?? 0;
  const maxDept = Math.max(1, ...(stats?.openByDept.map((d) => d.n) ?? [1]));
  const current = projects.find((p) => p.id === projectId) ?? projects[0];
  const openBoard = () => (current ? switchProject(current.id) : void newProjectFlow());

  const cards: { label: string; value: number | undefined; hint: string; onClick: () => void }[] = [
    { label: "Projects", value: projectsLoaded ? projects.length : undefined, hint: "Show projects", onClick: () => showActivity("command") },
    { label: "Open tasks", value: stats ? allTasks - total("done") : undefined, hint: "Open board", onClick: openBoard },
    { label: "In progress", value: stats ? total("doing") : undefined, hint: "Open board", onClick: openBoard },
    { label: "Agent runs (7d)", value: stats?.runs7d, hint: "Show agent runs", onClick: () => showActivity("runs") },
    { label: "Deliverables", value: stats?.deliverables, hint: "Show deliverables", onClick: () => showActivity("library") },
  ];

  const def = defaultAgent();

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 @3xl:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Command Center</h1>
            <p className="text-muted">You are the CEO. Every department is an AI agent. Plan → build → ship → grow.</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => delegate({ department: "ceo", brief: "Build my operating plan for this week across all departments. Force-rank the top 5 outcomes, then list the tasks per department." })}
          >
            <Rocket size={13} /> Plan my week
          </button>
        </header>

        {failed && (
          <div className="rounded border border-err/40 bg-err/10 px-3 py-2 text-[12.5px] text-err">
            Couldn’t load dashboard stats.{" "}
            <button className="underline" onClick={() => useWorkbench.getState().bump()}>
              Retry
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-5" aria-label="Key numbers">
          {cards.map((c) => (
            <button key={c.label} className="card group p-4 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] hover:bg-hover/40" onClick={c.onClick} title={c.hint}>
              <div className="text-[11px] text-muted">{c.label}</div>
              {c.value === undefined ? <Skeleton className="mt-2 h-7 w-12" /> : <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>}
              <div className="mt-1 text-[10.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{c.hint} →</div>
            </button>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 @4xl:grid-cols-3">
          <div className="card @container/pipe p-4 @4xl:col-span-2">
            <div className="section-title mb-3">Pipeline</div>
            {!projectsLoaded ? (
              <Skeleton className="h-28 w-full" />
            ) : projects.length ? (
              <div className="grid grid-cols-2 gap-2 @sm/pipe:grid-cols-3 @2xl/pipe:grid-cols-6">
                {STAGES.map((stage) => {
                  const inStage = projects.filter((p) => p.stage === stage);
                  return (
                    <div key={stage} className="min-h-20 rounded border border-line bg-editor p-2">
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-2 w-2 rounded-full" style={{ background: stageColor(stage) }} /> {stage}
                        <span className="ml-auto text-faint">{inStage.length || ""}</span>
                      </div>
                      <div className="space-y-1">
                        {inStage.map((p) => (
                          <button key={p.id} title={`Open ${p.name} board`} className="w-full truncate rounded bg-elev px-2 py-1 text-left text-[12px] hover:bg-hover" onClick={() => switchProject(p.id)}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact icon={FolderPlus} title="No projects yet" hint="Create a project and move it from idea to growing." action={{ label: "New project", icon: Plus, onClick: () => void newProjectFlow() }} secondary={{ label: "Open folder", onClick: () => void openFolderFlow() }} />
            )}
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="section-title">Agents</span>
              <button className="flex items-center gap-1 text-[11.5px] text-accent hover:underline" onClick={() => openSettings("settings-agents")}>
                <Settings2 size={12} /> Manage
              </button>
            </div>
            {!agents.length ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            ) : (
              <ul className="space-y-1.5">
                {agents.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[12.5px]" title={a.detail}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${a.available ? "bg-ok" : "bg-err"}`} aria-label={a.available ? "Available" : "Unavailable"} />
                    <DeptIcon name={a.icon || "Terminal"} size={13} />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.id === def && <span className="shrink-0 rounded bg-active px-1.5 text-[10px] text-fg">default</span>}
                    <span className="min-w-0 max-w-[40%] truncate text-[11px] text-faint">{a.available ? a.detail || "ready" : "not installed"}</span>
                  </li>
                ))}
              </ul>
            )}
            {!!agents.length && !agents.some((a) => a.available) && (
              <button className="btn mt-3 w-full justify-center" onClick={() => openSettings("settings-agents")}>
                <Terminal size={13} /> Set up {label(def)}
              </button>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 @4xl:grid-cols-3">
          <div className="card @container/dept p-4 @4xl:col-span-2">
            <div className="section-title mb-3">Departments</div>
            <div className="grid grid-cols-1 gap-2 @md/dept:grid-cols-2 @3xl/dept:grid-cols-3">
              {departments.map((d) => {
                const n = stats?.openByDept.find((x) => x.department === d.id)?.n ?? 0;
                return (
                  <button key={d.id} title={`Ask ${d.name}: ${d.role}`} className="flex items-start gap-2.5 rounded border border-line bg-editor p-2.5 text-left hover:bg-hover" onClick={() => delegate({ department: d.id, brief: "" })}>
                    <span className="mt-0.5">
                      <DeptIcon name={d.icon} color={d.color} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12.5px] font-medium">
                        <span className="truncate">{d.name}</span>
                        {n > 0 && <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-faint">{n} open</span>}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{d.role}</div>
                      <div className="mt-1.5 h-1 rounded bg-side">
                        <div className="h-full rounded" style={{ width: `${(n / maxDept) * 100}%`, background: d.color }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="section-title">Recent agent activity</span>
              <button className="text-[11.5px] text-accent hover:underline" onClick={() => showActivity("runs")}>
                All runs
              </button>
            </div>
            <div className="space-y-0.5">
              {loading &&
                Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-1 h-5 w-full" />)}
              {stats?.recentRuns.map((r) => {
                const d = getDepartment(r.department);
                return (
                  <button key={r.id} title={`${r.brief}\n${label(r.provider)} · ${r.status}`} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-hover" onClick={() => openTab({ kind: "run", id: r.id }, `Run · ${d.name}`)}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.status === "running" ? "animate-pulse bg-accent" : r.status === "done" ? "bg-ok" : r.status === "cancelled" ? "bg-faint" : "bg-err"}`} />
                    <DeptIcon name={d.icon} color={d.color} size={13} />
                    <span className="truncate text-[12.5px]">{r.brief}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">{timeAgo(r.created_at)}</span>
                  </button>
                );
              })}
              {stats && !stats.recentRuns.length && <EmptyState compact icon={Bot} title="No runs yet" hint="Pick a department to give it its first brief." />}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

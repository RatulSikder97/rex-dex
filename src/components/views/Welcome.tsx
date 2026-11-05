"use client";
import { useEffect, useState } from "react";
import { Blocks, Bot, Check, FolderGit2, FolderOpen, Keyboard, LayoutDashboard, Plus, RotateCcw, Sparkles, SquareKanban, Terminal, type LucideIcon } from "lucide-react";
import { LoadingRows, Pill } from "@/components/ui/kit";
import { api, timeAgo } from "@/lib/client";
import { useAgents, useWorkbench } from "@/store/workbench";
import { stageColor } from "@/components/workbench/SideBar";
import { newProjectFlow, openFolderFlow, openProjectSettings, openSetup, showActivity, switchProject } from "@/components/workbench/actions";
import { shortcut } from "@/components/workbench/shortcuts";

interface Stats {
  taskTotals: { status: string; n: number }[];
  runs7d: number;
  recentRuns: unknown[];
}

/** Get Started tab: start actions, a live walkthrough checklist, recent projects. */
export default function Welcome() {
  const { projects, projectId, openTab, version, setPalette, toggleAgent, launchTerminal } = useWorkbench();
  const { agents } = useAgents();
  const [stats, setStats] = useState<Stats | null>(null);
  const [extensions, setExtensions] = useState<number | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
    api<Stats>("/api/dashboard")
      .then((x) => {
        setStats(x);
        setStatsFailed(false);
      })
      .catch(() => setStatsFailed(true));
    api<unknown[]>("/api/plugins")
      .then((x) => setExtensions(x.length))
      .catch(() => setExtensions(0));
  }, [version]);

  const current = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  const tasks = stats?.taskTotals.reduce((a, b) => a + b.n, 0) ?? 0;
  const anyRuns = (stats?.recentRuns.length ?? 0) > 0 || (stats?.runs7d ?? 0) > 0;
  const agentReady = agents.some((a) => a.available);

  // Quick fix for step 1: an installed agent that still needs a sign-in, else one to install.
  const signIn = agents.find((a) => a.login && !a.available) ?? agents.find((a) => a.login);
  const install = agents.find((a) => !a.available && a.install);
  const quick = install
    ? { label: `Install ${install.label}`, run: () => launchTerminal({ id: install.id, action: "install" }) }
    : signIn
      ? { label: `Sign in to ${signIn.label}`, run: () => launchTerminal({ id: signIn.id, action: "login" }) }
      : undefined;

  const steps: { done: boolean; title: string; hint: string; icon: LucideIcon; action: { label: string; run: () => void }; secondary?: { label: string; run: () => void } }[] = [
    {
      done: agentReady,
      title: "Install an agent and sign in",
      hint: agentReady
        ? `Ready: ${agents.filter((a) => a.available).map((a) => a.label).join(", ")}`
        : "Departments run on agents in your terminal, like Claude Code or Codex. Install one and sign in from the integrated terminal.",
      icon: Terminal,
      action: { label: "Set up agents", run: () => useWorkbench.getState().openSettings("settings-agents") },
      secondary: quick,
    },
    {
      done: projects.length > 0,
      title: "Create a project",
      hint: "A project is a product you run. Every agent reads its description.",
      icon: Plus,
      action: { label: "New project", run: () => void newProjectFlow() },
    },
    {
      done: projects.some((p) => !!p.repo_path),
      title: "Link a repository",
      hint: "Point the project at a local folder so Engineering and QA can work in the code.",
      icon: FolderGit2,
      action: { label: current ? "Link repo" : "Open folder", run: () => (current ? openProjectSettings(current.id) : void openFolderFlow()) },
    },
    {
      done: tasks > 0,
      title: "Generate a plan on the board",
      hint: "Type a goal on the board and REX splits it into tasks across departments.",
      icon: SquareKanban,
      action: { label: "Open board", run: () => (current ? switchProject(current.id) : void newProjectFlow()) },
    },
    {
      done: anyRuns,
      title: "Delegate a task to an agent",
      hint: "Hover a task and choose Delegate, or ask any department in the agent panel.",
      icon: Bot,
      action: { label: "Open agent panel", run: () => toggleAgent(true) },
    },
    {
      done: (extensions ?? 0) > 0,
      title: "Install an extension",
      hint: "Add departments, agents, tools and media pipelines from the marketplace.",
      icon: Blocks,
      action: { label: "Browse extensions", run: () => showActivity("extensions") },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextStep = steps.findIndex((s) => !s.done);
  const checklistLoading = (stats === null && !statsFailed) || extensions === null;

  const start: { icon: LucideIcon; label: string; hint?: string; run: () => void }[] = [
    { icon: Plus, label: "New project…", hint: shortcut("newProject"), run: () => void newProjectFlow() },
    { icon: FolderOpen, label: "Open folder as project…", run: () => void openFolderFlow() },
    { icon: LayoutDashboard, label: "Open command center", run: () => openTab({ kind: "dashboard" }, "Command center") },
    { icon: Sparkles, label: "Show all commands", hint: shortcut("palette"), run: () => setPalette(true) },
    { icon: RotateCcw, label: "Run setup again…", run: openSetup },
  ];

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @3xl:gap-10 @3xl:px-8">
        <div className="min-w-0 space-y-6">
          <header>
            <h1 className="page-title">REX</h1>
            <p className="page-desc">Run a one-person company. You are the CEO; every department is an agent.</p>
          </header>

          <section aria-labelledby="welcome-start">
            <h2 id="welcome-start" className="section-title mb-1">
              Start
            </h2>
            <ul className="-mx-2">
              {start.map((a) => (
                <li key={a.label}>
                  <button className="row w-full rounded !px-2 text-left" onClick={a.run}>
                    <a.icon size={15} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {a.hint && <span className="kbd shrink-0">{a.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="welcome-recent">
            <h2 id="welcome-recent" className="section-title mb-1">
              Recent
            </h2>
            {projects.length ? (
              <ul className="-mx-2">
                {[...projects]
                  .sort((a, b) => b.updated_at - a.updated_at)
                  .slice(0, 6)
                  .map((p) => (
                    <li key={p.id}>
                      <button className="row w-full rounded !px-2 text-left" onClick={() => switchProject(p.id)} title={p.repo_path ? `${p.name} · ${p.repo_path}` : p.name}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageColor(p.stage) }} aria-hidden />
                        <span className="max-w-[55%] shrink-0 truncate">{p.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{p.repo_path || p.stage}</span>
                        <span className="shrink-0 text-[11px] text-faint">{timeAgo(p.updated_at)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No projects yet. Create one to get started.</p>
            )}
          </section>

          <section aria-labelledby="welcome-help">
            <h2 id="welcome-help" className="section-title mb-1">
              Help
            </h2>
            <ul className="-mx-2">
              <li>
                <button className="row w-full rounded !px-2 text-left" onClick={() => openTab({ kind: "shortcuts" }, "Keyboard shortcuts")}>
                  <Keyboard size={15} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Keyboard shortcuts</span>
                </button>
              </li>
            </ul>
          </section>
        </div>

        <section aria-labelledby="walkthrough" className="card h-fit min-w-0">
          <div className="card-head">
            <h2 id="walkthrough" className="min-w-0 flex-1 truncate">
              Get started
            </h2>
            <Pill tone={doneCount === steps.length ? "ok" : "neutral"}>
              {doneCount} of {steps.length} done
            </Pill>
          </div>
          <div className="h-0.5 bg-editor" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          {checklistLoading ? (
            <LoadingRows rows={6} height={44} className="p-3" />
          ) : (
            <ol className="divide-y divide-line">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-3 px-3 py-3">
                  <span
                    className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${
                      s.done ? "border-transparent bg-[color-mix(in_srgb,var(--ok)_18%,transparent)] text-ok" : i === nextStep ? "border-accent text-accent" : "border-line text-muted"
                    }`}
                    aria-hidden
                  >
                    {s.done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className={`min-w-0 flex-1 text-[13px] font-semibold ${s.done ? "text-muted" : ""}`}>
                        <span className="sr-only">{s.done ? "Done: " : `Step ${i + 1}: `}</span>
                        {s.title}
                      </div>
                      {s.done && <Pill tone="ok">Done</Pill>}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{s.hint}</p>
                    {!s.done && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className={`btn btn-sm ${i === nextStep ? "btn-primary" : ""}`} onClick={s.action.run}>
                          <s.icon size={13} /> {s.action.label}
                        </button>
                        {s.secondary && (
                          <button className="btn btn-sm" onClick={s.secondary.run}>
                            <Terminal size={13} /> {s.secondary.label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

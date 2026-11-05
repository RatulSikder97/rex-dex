"use client";
import { useEffect, useState } from "react";
import { Blocks, Bot, Check, FolderGit2, FolderOpen, Keyboard, LayoutDashboard, Plus, Sparkles, SquareKanban, Terminal, type LucideIcon } from "lucide-react";
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

  useEffect(() => {
    api<Stats>("/api/dashboard").then(setStats).catch(() => {});
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
      title: "Install and sign in to an AI agent CLI",
      hint: agentReady
        ? `Ready: ${agents.filter((a) => a.available).map((a) => a.label).join(", ")}`
        : "Departments run on terminal agents like Claude Code or Codex. Install one and sign in from the integrated terminal.",
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
      hint: "Hover a task and hit Delegate, or ask any department in the Agent panel.",
      icon: Bot,
      action: { label: "Open agent panel", run: () => toggleAgent(true) },
    },
    {
      done: (extensions ?? 0) > 0,
      title: "Install an extension",
      hint: "Add departments, agents, MCP servers, and media pipelines from the marketplace.",
      icon: Blocks,
      action: { label: "Browse extensions", run: () => showActivity("extensions") },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-8 @3xl:grid-cols-[1fr_1.25fr] @3xl:px-8 @3xl:py-10">
        <div className="space-y-8">
          <header>
            <h1 className="text-[28px] font-black tracking-tight">REX</h1>
            <p className="mt-1 text-[14px] text-muted">Run a one-person company. You are the CEO; every department is an AI agent.</p>
          </header>

          <section>
            <h2 className="section-title mb-2">Start</h2>
            <ul className="space-y-1">
              {[
                { icon: Plus, label: "New project…", hint: shortcut("newProject"), run: () => void newProjectFlow() },
                { icon: FolderOpen, label: "Open folder as project…", run: () => void openFolderFlow() },
                { icon: LayoutDashboard, label: "Open Command Center", run: () => openTab({ kind: "dashboard" }, "Command Center") },
                { icon: Sparkles, label: "Show all commands", hint: shortcut("palette"), run: () => setPalette(true) },
                { icon: Check, label: "Run setup again…", run: openSetup },
              ].map((a) => (
                <li key={a.label}>
                  <button className="flex items-center gap-2 rounded px-1 py-1 text-[13px] text-accent hover:underline" onClick={a.run}>
                    <a.icon size={15} /> {a.label}
                    {a.hint && <span className="kbd ml-1 no-underline">{a.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="section-title mb-2">Recent projects</h2>
            {projects.length ? (
              <ul className="space-y-0.5">
                {[...projects]
                  .sort((a, b) => b.updated_at - a.updated_at)
                  .slice(0, 6)
                  .map((p) => (
                    <li key={p.id}>
                      <button className="group flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-hover" onClick={() => switchProject(p.id)}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageColor(p.stage) }} />
                        <span className="max-w-[55%] shrink-0 truncate text-[13px] text-accent group-hover:underline">{p.name}</span>
                        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-faint" title={p.repo_path}>{p.repo_path || p.stage}</span>
                        <span className="shrink-0 text-[11px] text-faint">{timeAgo(p.updated_at)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">No projects yet. Create one to get started.</p>
            )}
          </section>

          <section>
            <h2 className="section-title mb-2">Help</h2>
            <button className="flex items-center gap-2 rounded px-1 py-1 text-[13px] text-accent hover:underline" onClick={() => openTab({ kind: "shortcuts" }, "Keyboard Shortcuts")}>
              <Keyboard size={15} /> Keyboard shortcuts cheatsheet
            </button>
          </section>
        </div>

        <section aria-labelledby="walkthrough" className="card h-fit p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 id="walkthrough" className="text-[14px] font-semibold">
              Get started with REX
            </h2>
            <span className="text-[11.5px] text-muted">
              {doneCount}/{steps.length} done
            </span>
          </div>
          <div className="mb-4 h-1 overflow-hidden rounded bg-editor" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <div className="h-full rounded bg-accent transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={s.title} className={`flex gap-3 rounded-md p-2.5 ${s.done ? "" : "bg-editor/60"}`}>
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold ${
                    s.done ? "border-ok bg-ok text-white" : "border-line text-muted"
                  }`}
                  aria-label={s.done ? "Done" : `Step ${i + 1}`}
                >
                  {s.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-medium ${s.done ? "text-muted line-through decoration-faint" : ""}`}>{s.title}</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{s.hint}</p>
                  {!s.done && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn btn-primary" onClick={s.action.run}>
                        <s.icon size={13} /> {s.action.label}
                      </button>
                      {s.secondary && (
                        <button className="btn" onClick={s.secondary.run}>
                          <Terminal size={13} /> {s.secondary.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

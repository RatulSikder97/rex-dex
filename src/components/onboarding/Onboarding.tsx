"use client";
/**
 * First-run setup: project → agents → connections (optional) → done.
 * Shown automatically on an empty project list; skippable; Help ▸ Welcome reopens it.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cable, Check, ChevronRight, FolderOpen, FolderPlus, LayoutPanelLeft, RotateCw, Terminal } from "lucide-react";
import { api } from "@/lib/client";
import type { ConnectionInfo, ProviderStatus } from "@/lib/types";
import { useAgents, useWorkbench } from "@/store/workbench";
import { pickFolder } from "@/components/ui/FolderPicker";
import { ProjectAvatar } from "@/components/ProjectLogo";
import { DeptIcon } from "@/components/icons";
import { Pill, LoadingRows, ErrorState } from "@/components/ui/kit";
import BottomPanel from "@/components/workbench/BottomPanel";
import { recheckAgents } from "@/components/workbench/actions";

export const ONBOARDED_KEY = "rex-onboarded";

type Step = "project" | "agents" | "connections" | "done";
const STEPS: { id: Step; label: string; optional?: boolean }[] = [
  { id: "project", label: "Project" },
  { id: "agents", label: "AI agents" },
  { id: "connections", label: "Connections", optional: true },
  { id: "done", label: "Ready" },
];

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the screen simply shows again next time the project list is empty */
  }
}

export function wasOnboarded(): boolean {
  try {
    return !!localStorage.getItem(ONBOARDED_KEY);
  } catch {
    return false;
  }
}

function finish(open?: { kind: "connections"; category?: string }) {
  markOnboarded();
  const s = useWorkbench.getState();
  s.setOnboarding(false);
  s.setLayoutMode("mission");
  s.setMission({ missionPage: null });
  if (open) s.openTab({ kind: "connections", category: open.category }, "Connections");
}

export default function Onboarding() {
  const projects = useWorkbench((s) => s.projects);
  const projectId = useWorkbench((s) => s.projectId);
  const terminalLaunch = useWorkbench((s) => s.terminalLaunch);
  const { agents } = useAgents();
  const [step, setStep] = useState<Step>(projects.length ? "agents" : "project");
  const [terminalShown, setTerminalShown] = useState(false);
  useEffect(() => {
    if (terminalLaunch) setTerminalShown(true);
  }, [terminalLaunch]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const agentReady = agents.some((a) => a.available && !a.authError);
  const doneFor: Record<Step, boolean> = { project: !!project, agents: agentReady, connections: false, done: false };
  const idx = STEPS.findIndex((s) => s.id === step);
  const go = (to: Step) => setStep(to);

  // Esc skips setup (same as "Skip setup"), unless a dialog/picker is on top.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"],[role="menu"]')) return;
      finish();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor" role="region" aria-label="Set up REX">
      <div className="flex min-h-0 flex-1">
        {/* Steps */}
        <nav aria-label="Setup steps" className="no-x-scroll flex w-[232px] shrink-0 flex-col border-r border-line bg-side">
          <div className="px-4 pb-3 pt-5">
            <div className="text-[15px] font-semibold">Set up REX</div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">You run the company. Each department is an AI agent working on your Mac.</p>
          </div>
          <ol className="mt-1">
            {STEPS.map((s, i) => {
              const done = doneFor[s.id] && i < idx;
              const on = s.id === step;
              const reachable = i <= idx || STEPS.slice(0, i).every((x) => doneFor[x.id] || x.optional);
              return (
                <li key={s.id}>
                  <button
                    className="row w-full !h-8 !gap-2.5 !px-4 disabled:opacity-50"
                    aria-current={on ? "step" : undefined}
                    aria-selected={on}
                    disabled={!reachable}
                    onClick={() => go(s.id)}
                  >
                    <span
                      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[10.5px] font-semibold tabular-nums ${
                        done ? "border-transparent bg-ok text-white" : on ? "border-accent text-fg" : "border-line text-muted"
                      }`}
                      aria-hidden
                    >
                      {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{s.label}</span>
                    {s.optional && <span className="text-[11px] text-faint">Optional</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto border-t border-line p-3">
            <button className="btn btn-ghost btn-sm w-full !justify-start" onClick={() => finish()} title="Skip setup (Esc). Reopen it from Help ▸ Welcome.">
              Skip setup
            </button>
          </div>
        </nav>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[640px] px-8 py-10">
              {step === "project" && <ProjectStep onNext={() => go("agents")} />}
              {step === "agents" && <AgentsStep agents={agents} onBack={() => go("project")} onNext={() => go("connections")} />}
              {step === "connections" && <ConnectionsStep onBack={() => go("agents")} onNext={() => go("done")} />}
              {step === "done" && <DoneStep projectName={project?.name ?? null} agentReady={agentReady} />}
            </div>
          </div>
          {terminalShown && (
            <div className="relative h-[260px] shrink-0">
              <BottomPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHeader({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="text-[12px] text-muted">Step {n} of {STEPS.length}</div>
      <h1 className="page-title mt-1">{title}</h1>
      {children && <p className="page-desc">{children}</p>}
    </header>
  );
}

function Footer({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
  return (
    <div className="mt-8 flex items-center gap-2 border-t border-line pt-4">
      {onBack && (
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      )}
      <span className="flex-1" />
      {next}
    </div>
  );
}

// ------------------------------------------------------------------ 1. project

function ProjectStep({ onNext }: { onNext: () => void }) {
  const projects = useWorkbench((s) => s.projects);
  const projectId = useWorkbench((s) => s.projectId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pick" | "new">(projects.length ? "pick" : "new");

  const chooseFolder = async () => {
    const dir = await pickFolder({ title: "Choose the project folder", message: "Pick the folder or git repository your Engineering and QA agents should work in.", confirmLabel: "Use this folder" });
    if (!dir) return;
    const clean = dir.replace(/\/+$/, "");
    setFolder(clean);
    if (!name.trim()) setName(clean.split("/").pop() ?? "");
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = useWorkbench.getState();
      const p = await api<{ id: string; name: string }>("/api/projects", {
        method: "POST",
        json: { name: name.trim(), description: description.trim() || undefined, repo_path: folder || undefined },
      });
      await s.loadProjects();
      s.setProject(p.id);
      s.bump();
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ob-project">
      <StepHeader n={1} title="Choose your first project">
        A project is a product you run. Every department reads its description, and the agents that write code work in its folder.
      </StepHeader>

      {projects.length > 0 && (
        <div className="seg mb-5" role="radiogroup" aria-label="Project">
          <button role="radio" aria-checked={mode === "pick"} onClick={() => setMode("pick")}>
            Existing project
          </button>
          <button role="radio" aria-checked={mode === "new"} onClick={() => setMode("new")}>
            New project
          </button>
        </div>
      )}

      {mode === "pick" && projects.length > 0 ? (
        <>
          <ul className="overflow-hidden rounded-[6px] border border-line" aria-label="Projects">
            {projects.map((p) => (
              <li key={p.id} className="border-b border-line last:border-0">
                <button className="row w-full !h-10 !gap-2.5" aria-selected={p.id === projectId} onClick={() => useWorkbench.getState().setProject(p.id)}>
                  <ProjectAvatar project={p} size={20} />
                  <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                  <span className="min-w-0 max-w-[45%] truncate font-mono text-[11px] text-faint" title={p.repo_path}>
                    {p.repo_path || "No folder"}
                  </span>
                  {p.id === projectId && <Check size={14} className="shrink-0 text-accent" aria-label="Selected" />}
                </button>
              </li>
            ))}
          </ul>
          <Footer
            next={
              <button className="btn btn-primary" disabled={!projectId} onClick={onNext}>
                Continue <ChevronRight size={13} />
              </button>
            }
          />
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-4"
        >
          <div className="field">
            <label className="label" htmlFor="ob-name">
              Name
            </label>
            <input id="ob-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Analytics" autoFocus maxLength={80} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ob-desc">
              What it is <span className="font-normal text-faint">(optional)</span>
            </label>
            <textarea id="ob-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it’s for, what it does, why it wins. Agents read this before every task." />
          </div>
          <div className="field">
            <span className="label" id="ob-folder-l">
              Folder <span className="font-normal text-faint">(optional)</span>
            </span>
            <div className="flex min-w-0 items-center gap-2" aria-labelledby="ob-folder-l">
              <div className={`input flex min-w-0 flex-1 items-center font-mono text-[12px] ${folder ? "" : "text-faint"}`} title={folder}>
                <span className="truncate">{folder || "No folder — add one later in the Project hub"}</span>
              </div>
              <button type="button" className="btn" onClick={() => void chooseFolder()}>
                <FolderOpen size={13} /> Choose…
              </button>
            </div>
            <p className="help">Pick an existing repository, or an empty folder for a new product.</p>
          </div>
          {error && (
            <p role="alert" className="text-[12px] text-err">
              {error}
            </p>
          )}
          <Footer
            next={
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
                <FolderPlus size={13} /> {busy ? "Creating…" : "Create project"}
              </button>
            }
          />
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 2. agents

function agentState(a: ProviderStatus): { tone: "ok" | "warn" | "neutral"; label: string } {
  if (a.available && a.authError) return { tone: "warn", label: "Sign-in needed" };
  if (a.available) return { tone: "ok", label: "Ready" };
  return { tone: "neutral", label: "Not installed" };
}

function AgentsStep({ agents, onBack, onNext }: { agents: ProviderStatus[]; onBack: () => void; onNext: () => void }) {
  const launch = useWorkbench((s) => s.launchTerminal);
  const [checking, setChecking] = useState(false);
  const ready = agents.some((a) => a.available && !a.authError);
  // Built-ins first, then installed extensions.
  const list = useMemo(() => [...agents].sort((a, b) => Number(b.builtin) - Number(a.builtin) || Number(b.available) - Number(a.available)), [agents]);
  const recheck = async () => {
    setChecking(true);
    await recheckAgents();
    setChecking(false);
  };

  return (
    <section>
      <StepHeader n={2} title="Connect an AI agent">
        Departments run on agent command-line tools installed on this Mac, using your own subscription. No API keys. You need at least one.
      </StepHeader>
      {!agents.length ? (
        <LoadingRows rows={3} height={52} />
      ) : (
        <ul className="overflow-hidden rounded-[6px] border border-line" aria-label="Agents">
          {list.map((a) => {
            const st = agentState(a);
            return (
              <li key={a.id} className="flex min-w-0 items-center gap-3 border-b border-line px-3 py-2.5 last:border-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-line bg-elev text-muted" aria-hidden>
                  <DeptIcon name={a.icon} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{a.label}</span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                  <div className="truncate text-[12px] text-muted" title={a.available ? a.detail : a.description}>
                    {a.available ? a.detail || a.description : a.description}
                  </div>
                </div>
                {!a.available && a.install && (
                  <button className="btn btn-sm" onClick={() => launch({ id: a.id, action: "install" })} title={`Runs “${a.install}” in the terminal`}>
                    <Terminal size={12} /> Install
                  </button>
                )}
                {a.login && (a.authError || a.available) && (
                  <button className={`btn btn-sm ${a.authError ? "btn-primary" : ""}`} onClick={() => launch({ id: a.id, action: "login" })} title="Opens the sign-in in the terminal and your browser">
                    Sign in
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        <button className="btn btn-ghost btn-sm" onClick={() => void recheck()} disabled={checking}>
          <RotateCw size={12} className={checking ? "animate-spin" : ""} /> {checking ? "Checking…" : "Check again"}
        </button>
        <span>Installed something in the terminal? Check again to detect it.</span>
      </div>
      <Footer
        onBack={onBack}
        next={
          <>
            {!ready && (
              <button className="btn btn-ghost" onClick={onNext}>
                Do this later
              </button>
            )}
            <button className="btn btn-primary" disabled={!ready} onClick={onNext}>
              Continue <ChevronRight size={13} />
            </button>
          </>
        }
      />
    </section>
  );
}

// ------------------------------------------------------------------ 3. connections

function ConnectionsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [list, setList] = useState<ConnectionInfo[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setError(null);
    api<ConnectionInfo[]>("/api/connections")
      .then(setList)
      .catch(setError);
  };
  useEffect(load, []);
  // Connected first, then the most broadly useful ones (used by the most departments).
  const shown = useMemo(
    () => (list ?? []).filter((c) => c.kind === "mcp").sort((a, b) => Number(b.status === "connected") - Number(a.status === "connected") || b.departments.length - a.departments.length).slice(0, 6),
    [list],
  );

  return (
    <section>
      <StepHeader n={3} title="Give your agents tools">
        Sign in to the services you already use, such as analytics, design and docs, so departments can read and act on real data. You can skip this and connect anything later.
      </StepHeader>
      {error ? (
        <ErrorState title="Couldn’t load connections" error={error} onRetry={load} compact />
      ) : !list ? (
        <LoadingRows rows={4} height={44} />
      ) : (
        <ul className="overflow-hidden rounded-[6px] border border-line" aria-label="Suggested connections">
          {shown.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-3 border-b border-line px-3 py-2 last:border-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-line bg-elev text-muted" aria-hidden>
                <DeptIcon name={c.icon} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{c.name}</div>
                <div className="truncate text-[12px] text-muted" title={c.description}>
                  {c.description}
                </div>
              </div>
              {c.status === "connected" ? (
                <Pill tone="ok" icon={Check}>
                  Connected
                </Pill>
              ) : (
                <button className="btn btn-sm" onClick={() => finish({ kind: "connections", category: c.category })}>
                  Set up
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-ghost btn-sm mt-3" onClick={() => finish({ kind: "connections" })}>
        <Cable size={12} /> Browse all connections
      </button>
      <Footer
        onBack={onBack}
        next={
          <button className="btn btn-primary" onClick={onNext}>
            Continue <ChevronRight size={13} />
          </button>
        }
      />
    </section>
  );
}

// ------------------------------------------------------------------ 4. done

function DoneStep({ projectName, agentReady }: { projectName: string | null; agentReady: boolean }) {
  return (
    <section>
      <StepHeader n={4} title={projectName ? `${projectName} is ready` : "You’re ready"}>
        Describe an outcome to the Chief of Staff and it plans the work across departments. You review, approve and ship.
      </StepHeader>
      <ul className="space-y-2 text-[13px]">
        <li className="flex items-center gap-2">
          {projectName ? <Check size={14} className="text-ok" /> : <span className="h-3.5 w-3.5 rounded-full border border-line" />}
          {projectName ? `Project: ${projectName}` : "No project yet — create one from the project menu"}
        </li>
        <li className="flex items-center gap-2">
          {agentReady ? <Check size={14} className="text-ok" /> : <span className="h-3.5 w-3.5 rounded-full border border-line" />}
          {agentReady ? "An AI agent is ready" : "No agent yet — install one from Settings ▸ Agents"}
        </li>
      </ul>
      <p className="mt-6 text-[12px] text-muted">Reopen this setup any time from Help ▸ Welcome.</p>
      <Footer
        next={
          <button className="btn btn-primary" onClick={() => finish()} autoFocus>
            <LayoutPanelLeft size={13} /> Open Mission
          </button>
        }
      />
    </section>
  );
}

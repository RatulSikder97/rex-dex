"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Network,
  Pencil,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Square,
  SquareKanban,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { api, streamRun, timeAgo, applyChunk } from "@/lib/client";
import type { Task } from "@/lib/types";
import AgentPicker from "@/components/AgentPicker";
import Markdown from "@/components/Markdown";
import { DeptIcon } from "@/components/icons";
import { confirmDialog } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { elapsed, useNow } from "@/components/mission/data";
import { useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import SwarmDag from "./SwarmDag";
import { SYNTH_KEY, createSwarm, deleteSwarm, isActive, openSwarmList, stepAction, swarmAction, useSwarm, type Step, type Swarm } from "./api";
import { StatusPill, StepBar, progressOf } from "./ui";

/** One agent swarm: header + controls, the DAG pipeline, and the selected step's detail. */
export default function SwarmView({ id, tabId }: { id: string; tabId: string }) {
  const { swarm, error, reload, apply } = useSwarm(id);
  const [selected, setSelected] = useState<string | null>(null);

  // Default selection: the running step, else a failed one, else synthesis when done, else the first.
  const sel = useMemo(() => {
    if (!swarm?.steps.length) return null;
    if (selected && swarm.steps.some((s) => s.id === selected)) return selected;
    const pick =
      swarm.steps.find((s) => s.status === "running") ??
      swarm.steps.find((s) => s.status === "error") ??
      (swarm.status === "done" ? swarm.steps.find((s) => s.key === SYNTH_KEY) : undefined) ??
      swarm.steps[0];
    return pick.id;
  }, [swarm, selected]);

  if (!swarm)
    return error ? (
      <EmptyState icon={Network} title="Couldn't load this swarm" hint={error} action={{ label: "Show all swarms", onClick: () => openSwarmList() }} />
    ) : (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-10 pt-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-52 rounded-xl" />
          ))}
        </div>
      </div>
    );

  const step = swarm.steps.find((s) => s.id === sel) ?? null;
  const synth = swarm.steps.find((s) => s.key === SYNTH_KEY);

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-5 p-5 pb-16">
        <Header swarm={swarm} tabId={tabId} onChanged={(s) => (s ? apply(s) : reload())} />

        {swarm.status === "planning" && <Planning swarm={swarm} />}
        {swarm.status !== "planning" && !swarm.steps.length && <PlanFailed swarm={swarm} tabId={tabId} />}

        {swarm.status === "done" && synth && <Result swarm={swarm} synth={synth} />}

        {!!swarm.steps.length && (
          <div className="grid grid-cols-1 items-start gap-4 @[1400px]:grid-cols-[minmax(0,1fr)_420px]">
            <section aria-label="Pipeline" className="min-w-0 rounded-xl border border-line bg-elev/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[13px] font-semibold">Pipeline</h2>
                <span className="text-[11.5px] text-muted">
                  {swarm.steps.length - 1} specialist step{swarm.steps.length === 2 ? "" : "s"} → synthesis · up to {swarm.max_parallel} in parallel
                </span>
              </div>
              <SwarmDag steps={swarm.steps} selected={sel} onSelect={setSelected} />
              {swarm.status === "planned" && (
                <p className="mt-3 text-[12px] text-muted">
                  Review the plan: click a step to edit its brief or re-assign its agent, then <b className="text-fg">Start</b>.
                </p>
              )}
            </section>
            {step && <StepDetail key={step.id} swarm={swarm} step={step} onChanged={(s) => (s ? apply(s) : reload())} onSelect={setSelected} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- header

function Header({ swarm, tabId, onChanged }: { swarm: Swarm; tabId: string; onChanged: (s: Swarm | null) => void }) {
  const projects = useWorkbench((s) => s.projects);
  const project = projects.find((p) => p.id === swarm.project_id);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const { done, total } = progressOf(swarm);
  const lines = swarm.goal.trim().split("\n");
  const headline = lines[0] ?? "Swarm";
  const rest = lines.slice(1).join("\n").trim();
  const started = swarm.steps.map((s) => s.started_at).filter((x): x is number => !!x);
  const t0 = started.length ? Math.min(...started) : swarm.created_at;
  const t1 = swarm.finished_at ?? (isActive(swarm) ? now : Math.max(t0, ...swarm.steps.map((s) => s.finished_at ?? 0)));

  useEffect(() => {
    if (!swarm.task_id || !swarm.project_id) return;
    let stop = false;
    api<Task[]>(`/api/tasks?projectId=${encodeURIComponent(swarm.project_id)}`)
      .then((ts) => !stop && setTask(ts.find((t) => t.id === swarm.task_id) ?? null))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [swarm.task_id, swarm.project_id, swarm.status]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const start = () => act("start", async () => onChanged(await swarmAction(swarm.id, "start")));
  const cancel = () =>
    act("cancel", async () => {
      if (!(await confirmDialog({ title: "Cancel this swarm?", message: "Running steps are stopped and pending steps won't start. Finished step outputs are kept.", confirmLabel: "Cancel swarm", cancelLabel: "Keep running", danger: true }))) return;
      onChanged(await swarmAction(swarm.id, "cancel"));
    });
  const remove = () =>
    act("delete", async () => {
      if (!(await confirmDialog({ title: "Delete this swarm?", message: "The plan and step history are removed. Agent runs and any saved deliverable stay.", confirmLabel: "Delete", danger: true }))) return;
      if (await deleteSwarm(swarm.id)) {
        useWorkbench.getState().closeTab(tabId);
        openSwarmList();
      }
    });

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
          <Network size={17} />
        </span>
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={swarm.status} />
            <span className="text-[11.5px] text-faint">Agent swarm · created {timeAgo(swarm.created_at)}</span>
          </div>
          <h1 className={`mt-1 text-[16px] font-semibold leading-snug ${open ? "" : "line-clamp-2"}`}>{headline}</h1>
          {rest && (
            <>
              {open && <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{rest}</p>}
              <button className="mt-1 flex items-center gap-1 text-[11.5px] text-accent hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? "Less" : "Full goal"}
              </button>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {swarm.status === "planned" && (
            <button className="btn btn-primary !h-8 !rounded-lg !px-3" onClick={() => void start()} disabled={!!busy}>
              {busy === "start" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Start swarm
            </button>
          )}
          {isActive(swarm) && (
            <button className="btn !h-8 !rounded-lg" onClick={() => void cancel()} disabled={!!busy}>
              {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} />} Cancel
            </button>
          )}
          {!isActive(swarm) && (
            <button className="btn !h-8 !rounded-lg" onClick={() => void remove()} disabled={!!busy} title="Delete swarm">
              <Trash2 size={13} /> {swarm.status === "planned" ? "Discard" : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-elev/30 px-3.5 py-2.5 text-[12px] text-muted">
        <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
          <StepBar swarm={swarm} className="w-full max-w-[240px]" />
          <span className="shrink-0 tabular-nums">
            <b className="text-fg">{done}</b>/{total || "–"} steps
          </span>
        </span>
        {swarm.status !== "planning" && swarm.status !== "planned" && (
          <span className="tabular-nums" title="Elapsed">
            ⏱ {elapsed(t0, t1)}
          </span>
        )}
        <span title="Steps that may run at the same time">{swarm.max_parallel}× parallel</span>
        <span title={swarm.allow_edits ? "Engineering / QA steps may edit files in the linked repo" : "Steps are read-only"}>{swarm.allow_edits ? "File edits allowed" : "Read-only"}</span>
        {project && (
          <button className="flex items-center gap-1 hover:text-fg" onClick={() => useWorkbench.getState().openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)} title="Open the project board">
            <FolderOpen size={12} /> {project.name}
          </button>
        )}
        {swarm.task_id && project && (
          <button
            className="flex min-w-0 max-w-[260px] items-center gap-1 hover:text-fg"
            onClick={() => useWorkbench.getState().openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)}
            title={task ? `Linked task: ${task.title} (${task.status})` : "Linked board task"}
          >
            <SquareKanban size={12} className="shrink-0" /> <span className="truncate">{task?.title ?? "Board task"}</span>
            {task && <span className="shrink-0 text-faint">· {task.status}</span>}
          </button>
        )}
      </div>
      {swarm.error && swarm.status === "error" && !!swarm.steps.length && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] px-3.5 py-2.5 text-[12.5px] text-err">{swarm.error}</div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------- planning / failed plan

function Planning({ swarm }: { swarm: Swarm }) {
  const now = useNow();
  const { getDepartment } = useDepartments();
  const ceo = getDepartment("ceo");
  return (
    <section aria-live="polite" className="rounded-xl border border-line bg-elev/30 px-6 py-10 text-center">
      <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${ceo.color} 16%, transparent)`, color: ceo.color }}>
        <span className="absolute inset-0 animate-ping rounded-2xl opacity-20" style={{ background: ceo.color }} aria-hidden />
        <DeptIcon name={ceo.icon} size={24} />
      </span>
      <h2 className="mt-4 text-[14px] font-semibold">{ceo.name} is planning the swarm…</h2>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-muted">
        Splitting the goal into department steps, deciding what can run in parallel and how the results get merged. This usually takes 20–60 seconds.
      </p>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] tabular-nums text-accent">
        <Loader2 size={13} className="animate-spin" /> {elapsed(swarm.created_at, now)}
      </p>
      <div className="mx-auto mt-6 flex max-w-xl items-center justify-center gap-6 opacity-60" aria-hidden>
        {[3, 2, 1].map((n, i) => (
          <div key={i} className="flex flex-col gap-2">
            {Array.from({ length: n }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-28 rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanFailed({ swarm, tabId }: { swarm: Swarm; tabId: string }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    const next = await createSwarm({ projectId: swarm.project_id, taskId: swarm.task_id, goal: swarm.goal, maxParallel: swarm.max_parallel, allowEdits: swarm.allow_edits, autoStart: false });
    if (next && (await deleteSwarm(swarm.id))) useWorkbench.getState().closeTab(tabId);
    setBusy(false);
  };
  return (
    <section className="rounded-xl border border-line bg-elev/30">
      <EmptyState
        icon={CircleSlash}
        title={swarm.status === "cancelled" ? "Planning was cancelled" : "Planning failed"}
        hint={swarm.error ?? "The Chief of Staff couldn't produce a plan."}
        action={{ label: busy ? "Re-planning…" : "Plan again", icon: RotateCcw, onClick: () => void retry() }}
      />
    </section>
  );
}

// ---------------------------------------------------------------- result

function Result({ swarm, synth }: { swarm: Swarm; synth: Step }) {
  const [full, setFull] = useState(false);
  // Same cleaning as the saved deliverable: drop the agent's tool-call trace lines.
  const text = (synth.output ?? "")
    .split("\n")
    .filter((l) => !/^> (🔧|✏️|⚠️)/.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const openDeliverable = () => swarm.deliverable_id && useWorkbench.getState().openTab({ kind: "deliverable", id: swarm.deliverable_id }, `Swarm: ${swarm.goal.split("\n")[0].slice(0, 40)}`);
  return (
    <section aria-label="Result" className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--ok)_35%,var(--border))] bg-[color-mix(in_srgb,var(--ok)_5%,var(--bg-elev))]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Sparkles size={14} className="text-ok" />
        <h2 className="text-[13px] font-semibold">Final deliverable</h2>
        <span className="text-[11.5px] text-muted">merged by the Chief of Staff</span>
        <span className="flex-1" />
        <button className="btn !rounded-lg" onClick={() => void navigator.clipboard.writeText(text)} disabled={!text}>
          <Copy size={12} /> Copy
        </button>
        {swarm.deliverable_id && (
          <button className="btn btn-primary !rounded-lg" onClick={openDeliverable}>
            <FileText size={12} /> Open deliverable
          </button>
        )}
      </div>
      <div className={`relative px-4 py-3 ${full ? "" : "max-h-[360px] overflow-hidden"}`}>
        {text ? <Markdown text={text} /> : <p className="text-[12.5px] text-muted">The synthesis step produced no output.</p>}
        {!full && text.length > 900 && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[color-mix(in_srgb,var(--ok)_5%,var(--bg-elev))] to-transparent" aria-hidden />}
      </div>
      {text.length > 900 && (
        <button className="flex w-full items-center justify-center gap-1 border-t border-line py-1.5 text-[12px] text-accent hover:bg-hover" onClick={() => setFull((f) => !f)} aria-expanded={full}>
          {full ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {full ? "Collapse" : "Show all"}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- step detail

function StepDetail({ swarm, step, onChanged, onSelect }: { swarm: Swarm; step: Step; onChanged: (s: Swarm | null) => void; onSelect: (id: string) => void }) {
  const { getDepartment } = useDepartments();
  const agents = useAgents();
  const now = useNow();
  const d = getDepartment(step.department);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(step.brief);
  const [live, setLive] = useState<{ runId: string; text: string } | null>(null);
  const editable = step.status === "pending" || step.status === "error" || step.status === "skipped" || step.status === "cancelled";
  const synth = step.key === SYNTH_KEY;
  const agentId = step.provider ?? step.agent ?? agents.forDepartment(step.department);

  useEffect(() => {
    if (!editing) setBrief(step.brief);
  }, [step.brief, editing]);

  // Stream the step's run while it's running (the 2s poll also carries the output; the stream is smoother).
  useEffect(() => {
    if (step.status !== "running" || !step.run_id) return;
    const runId = step.run_id;
    return streamRun(runId, (ev) =>
      setLive((cur) => {
        const base = cur?.runId === runId ? cur.text : "";
        if (ev.type === "chunk") return { runId, text: applyChunk(base, ev) };
        if (ev.type === "snapshot") return { runId, text: ev.output };
        return cur;
      }),
    );
  }, [step.status, step.run_id]);

  const polled = step.output ?? "";
  const streamed = live && live.runId === step.run_id ? live.text : "";
  const output = streamed.length >= polled.length ? streamed : polled;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const run = (action: "retry" | "skip" | "set-agent" | "edit", patch?: Parameters<typeof stepAction>[3]) => act(action, async () => onChanged(await stepAction(swarm.id, step.id, action, patch)));
  const skip = () =>
    act("skip", async () => {
      if (
        !(await confirmDialog({
          title: `Skip "${step.title}"?`,
          message: step.status === "running" ? "Its run is stopped. Steps that depend on it continue without its output." : "Steps that depend on it continue without its output.",
          confirmLabel: "Skip step",
          danger: true,
        }))
      )
        return;
      onChanged(await stepAction(swarm.id, step.id, "skip"));
    });

  const deps = step.depends_on.map((k) => swarm.steps.find((s) => s.key === k)).filter((s): s is Step => !!s);
  const time = step.started_at ? elapsed(step.started_at, step.finished_at ?? (step.status === "running" ? now : step.started_at)) : null;
  const terminal = () =>
    useWorkbench.getState().launchTerminal({ id: agentId, action: "interactive", department: step.department, threadId: `swarm:${swarm.id}:${step.key}` });

  return (
    <section aria-label={`Step: ${step.title}`} className="flex min-w-0 flex-col rounded-xl border border-line bg-elev/30 @[1400px]:sticky @[1400px]:top-0 @[1400px]:max-h-[calc(100vh-120px)]">
      <div className="space-y-2.5 border-b border-line p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color }}>
            {synth ? <Sparkles size={14} /> : <DeptIcon name={d.icon} size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] text-muted">
              {d.name}
              {time && <span className="tabular-nums"> · {time}</span>}
            </div>
            <h3 className="text-[13.5px] font-semibold leading-snug">{step.title}</h3>
          </div>
          <StatusPill status={step.status} kind="step" />
        </div>

        {!!deps.length && (
          <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
            <span className="mr-0.5">Waits for</span>
            {deps.map((s) => (
              <button key={s.id} className="max-w-[180px] truncate rounded-md border border-line px-1.5 leading-[18px] hover:border-accent hover:text-fg" onClick={() => onSelect(s.id)}>
                {s.title}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
            Agent
            <AgentPicker
              value={step.agent ?? ""}
              department={step.department}
              className="input h-7 w-auto max-w-[190px] text-[11.5px]"
              title={step.status === "running" ? "Agent can't change while the step runs" : "Terminal agent for this step"}
              onChange={(v) => void run("set-agent", { agent: v })}
            />
          </label>
          {step.provider && step.agent && step.provider !== step.agent && <span className="text-[11px] text-faint">ran on {agents.label(step.provider)}</span>}
          {busy === "set-agent" && <Loader2 size={12} className="animate-spin text-faint" />}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(step.status === "error" || step.status === "cancelled" || step.status === "skipped" || step.status === "done") && (
            <button className={`btn !h-7 !rounded-lg ${step.status === "error" ? "btn-primary" : ""}`} onClick={() => void run("retry")} disabled={!!busy}>
              {busy === "retry" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} {step.status === "done" ? "Re-run" : "Retry"}
            </button>
          )}
          {(step.status === "pending" || step.status === "running" || step.status === "error") && !synth && (
            <button className="btn !h-7 !rounded-lg" onClick={() => void skip()} disabled={!!busy}>
              <SkipForward size={12} /> Skip
            </button>
          )}
          {step.run_id && (
            <button className="btn !h-7 !rounded-lg" onClick={() => useWorkbench.getState().openTab({ kind: "run", id: step.run_id! }, `Run · ${d.name}`)}>
              <History size={12} /> Open run
            </button>
          )}
          <button className="btn !h-7 !rounded-lg" onClick={terminal} title={`Open this step's ${agents.label(agentId)} session in the terminal`}>
            <SquareTerminal size={12} /> Terminal
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {step.error && <div className="whitespace-pre-wrap break-words rounded-lg border border-[color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] px-3 py-2 font-mono text-[11.5px] text-err">{step.error}</div>}

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="section-title">Brief</span>
            <span className="flex-1" />
            {editable && !editing && (
              <button className="flex items-center gap-1 text-[11.5px] text-accent hover:underline" onClick={() => setEditing(true)}>
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="space-y-1.5">
              <textarea className="input !h-auto min-h-[140px] py-1.5 leading-relaxed" value={brief} onChange={(e) => setBrief(e.target.value)} aria-label="Step brief" autoFocus />
              <div className="flex justify-end gap-1.5">
                <button
                  className="btn !h-7 !rounded-lg"
                  onClick={() => {
                    setEditing(false);
                    setBrief(step.brief);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary !h-7 !rounded-lg"
                  disabled={!brief.trim() || busy === "edit"}
                  onClick={() =>
                    void run("edit", { brief: brief.trim() }).then(() => {
                      setEditing(false);
                    })
                  }
                >
                  {busy === "edit" && <Loader2 size={12} className="animate-spin" />} Save brief
                </button>
              </div>
            </div>
          ) : (
            <p className="line-clamp-[8] whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{step.brief}</p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="section-title">Output</span>
            {step.status === "running" && <Loader2 size={11} className="animate-spin text-accent" />}
            <span className="flex-1" />
            {output && (
              <button className="flex items-center gap-1 text-[11.5px] text-muted hover:text-fg" onClick={() => void navigator.clipboard.writeText(output)}>
                <Copy size={11} /> Copy
              </button>
            )}
          </div>
          {output ? (
            <div className="rounded-lg border border-line bg-editor px-3 py-2">
              <Markdown text={output} streaming={step.status === "running"} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-faint">
              {step.status === "running"
                ? "Waiting for the agent's first words…"
                : step.status === "pending"
                  ? deps.some((s) => s.status !== "done" && s.status !== "skipped")
                    ? "Starts when the steps it waits for finish."
                    : swarm.status === "planned"
                      ? "Starts when you start the swarm."
                      : "Queued — waiting for a free parallel slot."
                  : "No output."}
            </p>
          )}
          {synth && swarm.deliverable_id && (
            <button className="btn mt-2 !rounded-lg" onClick={() => useWorkbench.getState().openTab({ kind: "deliverable", id: swarm.deliverable_id! }, `Swarm: ${swarm.goal.split("\n")[0].slice(0, 40)}`)}>
              <ExternalLink size={12} /> Open deliverable
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

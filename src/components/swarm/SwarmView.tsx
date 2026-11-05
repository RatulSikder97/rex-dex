"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock,
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
import { ErrorState } from "@/components/ui/kit";
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
      <div className="flex flex-col items-center">
        <ErrorState title="Couldn’t load this swarm" error={`${error}. It may have been deleted; retry or go back to the list.`} onRetry={reload} />
        <button className="btn btn-ghost btn-sm -mt-6" onClick={() => openSwarmList()}>
          Show all swarms
        </button>
      </div>
    ) : (
      <div className="space-y-3 px-6 py-5" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-[18px] w-24" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-10 pt-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px] w-[224px] rounded-[6px]" />
          ))}
        </div>
      </div>
    );

  const step = swarm.steps.find((s) => s.id === sel) ?? null;
  const synth = swarm.steps.find((s) => s.key === SYNTH_KEY);

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-4 px-6 pb-8 pt-5">
        <Header swarm={swarm} tabId={tabId} onChanged={(s) => (s ? apply(s) : reload())} />

        {swarm.status === "planning" && <Planning swarm={swarm} />}
        {swarm.status !== "planning" && !swarm.steps.length && <PlanFailed swarm={swarm} tabId={tabId} />}

        {swarm.status === "done" && synth && <Result swarm={swarm} synth={synth} />}

        {!!swarm.steps.length && (
          <div className="grid grid-cols-1 items-start gap-4 @[1400px]:grid-cols-[minmax(0,1fr)_420px]">
            <section aria-label="Pipeline" className="card min-w-0">
              <div className="card-head">
                <h2 className="text-[13px] font-semibold">Pipeline</h2>
                <span className="min-w-0 truncate text-[11px] font-normal text-muted">
                  {swarm.steps.length - 1} specialist step{swarm.steps.length === 2 ? "" : "s"} → synthesis · up to {swarm.max_parallel} in parallel
                </span>
              </div>
              <div className="p-3">
                <SwarmDag steps={swarm.steps} selected={sel} onSelect={setSelected} />
              </div>
              {swarm.status === "planned" && (
                <p className="border-t border-line px-3 py-2 text-[12px] text-muted">
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
    <header className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={swarm.status} />
            <span className="text-[11px] text-muted">Swarm · created {timeAgo(swarm.created_at)}</span>
          </div>
          <h1 className={`page-title mt-1.5 ${open ? "" : "line-clamp-2"}`} title={open ? undefined : headline}>
            {headline}
          </h1>
          {rest && (
            <>
              {open && <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{rest}</p>}
              <button className="btn btn-ghost btn-sm -ml-2 mt-0.5" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {open ? "Show less" : "Full goal"}
              </button>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {swarm.status === "planned" && (
            <button className="btn btn-primary" onClick={() => void start()} disabled={!!busy}>
              {busy === "start" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Start swarm
            </button>
          )}
          {isActive(swarm) && (
            <button className="btn" onClick={() => void cancel()} disabled={!!busy}>
              {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} />} Cancel
            </button>
          )}
          {!isActive(swarm) && (
            <button className="btn btn-danger-ghost" onClick={() => void remove()} disabled={!!busy} title="Delete swarm">
              <Trash2 size={13} /> {swarm.status === "planned" ? "Discard" : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line pb-3 text-[12px] text-muted">
        <span className="flex min-w-[180px] flex-1 items-center gap-2.5">
          <StepBar swarm={swarm} className="w-full max-w-[240px]" />
          <span className="shrink-0 tabular-nums">
            <b className="text-fg">{done}</b>/{total || "–"} steps
          </span>
        </span>
        {swarm.status !== "planning" && swarm.status !== "planned" && (
          <span className="flex items-center gap-1 tabular-nums" title="Elapsed">
            <Clock size={12} aria-hidden /> {elapsed(t0, t1)}
          </span>
        )}
        <span title="Steps that may run at the same time">{swarm.max_parallel}× parallel</span>
        <span title={swarm.allow_edits ? "Engineering / QA steps may edit files in the linked repo" : "Steps are read-only"}>{swarm.allow_edits ? "File edits allowed" : "Read-only"}</span>
        {project && (
          <button className="flex min-w-0 max-w-[200px] items-center gap-1 hover:text-fg" onClick={() => useWorkbench.getState().openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)} title={`Open the ${project.name} board`}>
            <FolderOpen size={12} className="shrink-0" /> <span className="truncate">{project.name}</span>
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
        <div role="alert" className="rounded-[6px] border border-[color-mix(in_srgb,var(--err)_40%,var(--border))] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] px-3 py-2 text-[12.5px] text-err">{swarm.error}</div>
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
    <section aria-live="polite" className="card px-6 py-8 text-center">
      <span className="mx-auto grid h-9 w-9 place-items-center rounded-[6px]" style={{ background: `color-mix(in srgb, ${ceo.color} 16%, transparent)`, color: ceo.color }}>
        <DeptIcon name={ceo.icon} size={18} />
      </span>
      <h2 className="mt-3 text-[13px] font-semibold">{ceo.name} is planning the swarm</h2>
      <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted">
        Splitting the goal into department steps and deciding what can run in parallel. This usually takes 20–60 seconds.
      </p>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] tabular-nums text-accent">
        <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> {elapsed(swarm.created_at, now)}
      </p>
      <div className="mx-auto mt-6 flex max-w-xl items-center justify-center gap-6" aria-hidden>
        {[3, 2, 1].map((n, i) => (
          <div key={i} className="flex flex-col gap-2">
            {Array.from({ length: n }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-28 rounded-[6px]" />
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
    <section className="card">
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
    <section aria-label="Result" className="card overflow-hidden">
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <Sparkles size={14} className="text-ok" aria-hidden />
        <h2 className="text-[13px] font-semibold">Final deliverable</h2>
        <span className="text-[11px] text-muted">Merged by the Chief of Staff</span>
        <span className="flex-1" />
        <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(text)} disabled={!text}>
          <Copy size={12} /> Copy
        </button>
        {swarm.deliverable_id && (
          <button className="btn btn-primary btn-sm" onClick={openDeliverable}>
            <FileText size={12} /> Open deliverable
          </button>
        )}
      </div>
      <div className={`px-4 py-3 ${full ? "" : "max-h-[360px] overflow-hidden"}`}>
        {text ? <Markdown text={text} /> : <p className="text-[12.5px] text-muted">The synthesis step produced no output.</p>}
      </div>
      {text.length > 900 && (
        <button className="flex h-7 w-full items-center justify-center gap-1 border-t border-line text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => setFull((f) => !f)} aria-expanded={full}>
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
    <section aria-label={`Step: ${step.title}`} className="card flex min-w-0 flex-col @[1400px]:sticky @[1400px]:top-0 @[1400px]:max-h-[calc(100vh-120px)]">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px]" style={{ background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color }}>
            {synth ? <Sparkles size={14} /> : <DeptIcon name={d.icon} size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-muted">
              {d.name}
              {time && <span className="tabular-nums"> · {time}</span>}
            </div>
            <h3 className="text-[13px] font-semibold leading-snug">{step.title}</h3>
          </div>
          <StatusPill status={step.status} kind="step" />
        </div>

        {!!deps.length && (
          <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
            <span className="mr-0.5">Waits for</span>
            {deps.map((s) => (
              <button key={s.id} className="max-w-[180px] truncate rounded-[4px] border border-line px-1.5 leading-[18px] hover:bg-hover hover:text-fg" onClick={() => onSelect(s.id)} title={s.title}>
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
              className="input input-sm w-auto max-w-[190px]"
              title={step.status === "running" ? "Agent can't change while the step runs" : "Terminal agent for this step"}
              onChange={(v) => void run("set-agent", { agent: v })}
            />
          </label>
          {step.provider && step.agent && step.provider !== step.agent && <span className="text-[11px] text-faint">ran on {agents.label(step.provider)}</span>}
          {busy === "set-agent" && <Loader2 size={12} className="animate-spin text-faint" aria-label="Saving" />}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(step.status === "error" || step.status === "cancelled" || step.status === "skipped" || step.status === "done") && (
            <button className={`btn btn-sm ${step.status === "error" ? "btn-primary" : ""}`} onClick={() => void run("retry")} disabled={!!busy}>
              {busy === "retry" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} {step.status === "done" ? "Re-run" : "Retry"}
            </button>
          )}
          {(step.status === "pending" || step.status === "running" || step.status === "error") && !synth && (
            <button className="btn btn-sm" onClick={() => void skip()} disabled={!!busy}>
              <SkipForward size={12} /> Skip
            </button>
          )}
          {step.run_id && (
            <button className="btn btn-sm" onClick={() => useWorkbench.getState().openTab({ kind: "run", id: step.run_id! }, `Run · ${d.name}`)}>
              <History size={12} /> Open run
            </button>
          )}
          <button className="btn btn-sm" onClick={terminal} title={`Open this step's ${agents.label(agentId)} session in the terminal`}>
            <SquareTerminal size={12} /> Terminal
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {step.error && <div className="whitespace-pre-wrap break-words rounded-[6px] border border-[color-mix(in_srgb,var(--err)_40%,var(--border))] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] px-3 py-2 font-mono text-[11.5px] text-err">{step.error}</div>}

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="section-title">Brief</span>
            <span className="flex-1" />
            {editable && !editing && (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={11} /> Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="space-y-1.5">
              <textarea className="input min-h-[140px]" value={brief} onChange={(e) => setBrief(e.target.value)} aria-label="Step brief" autoFocus />
              <div className="flex justify-end gap-1.5">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setBrief(step.brief);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
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
            {step.status === "running" && <Loader2 size={11} className="animate-spin text-accent motion-reduce:animate-none" aria-label="Running" />}
            <span className="flex-1" />
            {output && (
              <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(output)}>
                <Copy size={11} /> Copy
              </button>
            )}
          </div>
          {output ? (
            <div className="rounded-[6px] border border-line bg-editor px-3 py-2">
              <Markdown text={output} streaming={step.status === "running"} />
            </div>
          ) : (
            <p className="rounded-[6px] border border-dashed border-line px-3 py-4 text-center text-[12px] text-muted">
              {step.status === "running"
                ? "Waiting for the agent's first words…"
                : step.status === "pending"
                  ? deps.some((s) => s.status !== "done" && s.status !== "skipped")
                    ? "Starts when the steps it waits for finish."
                    : swarm.status === "planned"
                      ? "Starts when you start the swarm."
                      : "Queued. Waiting for a free parallel slot."
                  : "No output."}
            </p>
          )}
          {synth && swarm.deliverable_id && (
            <button className="btn btn-sm mt-2" onClick={() => useWorkbench.getState().openTab({ kind: "deliverable", id: swarm.deliverable_id! }, `Swarm: ${swarm.goal.split("\n")[0].slice(0, 40)}`)}>
              <ExternalLink size={12} /> Open deliverable
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

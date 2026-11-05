"use client";
import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  Film,
  ListTodo,
  Loader2,
  Mic,
  Network,
  PackageOpen,
  Rocket,
  Send,
  Sparkles,
  SquareKanban,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { STAGES, TASK_STATUSES, type Priority, type Run, type Stage, type Task, type TaskStatus } from "@/lib/types";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { createSwarm, isActive, openSwarm, openSwarmList, useSwarms, type Swarm } from "@/components/swarm/api";
import { StepBar, SWARM_META, progressOf } from "@/components/swarm/ui";
import { swarmTask } from "@/components/swarm/api";
import { briefTitle, elapsed, useMissionData, useNow } from "./data";
import { useIssues } from "./IssuesTab";
import { focusConversation, openPage, showWorkspace } from "./nav";
import { DeptAvatar, Section, SectionAction, StatusDot } from "./ui";

const STATUS_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", todo: "To do", doing: "Doing", review: "Review", done: "Done" };
const LANE_COLOR: Record<TaskStatus, string> = {
  backlog: "color-mix(in srgb, var(--fg-faint) 55%, transparent)",
  todo: "color-mix(in srgb, var(--accent) 45%, transparent)",
  doing: "var(--accent)",
  review: "var(--warn)",
  done: "var(--ok)",
};
const PRIORITY_COLOR: Record<Priority, string> = { urgent: "var(--err)", high: "var(--warn)", medium: "var(--accent)", low: "var(--fg-faint)" };
const RECENT_SWARM_MS = 12 * 3600_000;
const TIMELINE_CAP = 5;

/** Pipeline ("Mission board"): summary strip → plan a goal → one activity timeline → work lanes. */
export default function PipelineTab() {
  const project = useActiveProject();
  const { runs, jobs, tasks, loaded } = useMissionData();
  const { swarms } = useSwarms(project?.id);
  const lanesRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  if (!project) return null;
  const projectJobs = jobs.filter((j) => !j.project_id || j.project_id === project.id);
  const fresh = loaded && swarms !== null && !tasks.length && !runs.length && !(swarms ?? []).length && !projectJobs.some((j) => j.status === "running" || j.status === "queued");

  return (
    <div className="space-y-6 px-4 pb-6 pt-4">
      <SummaryStrip
        stage={project.stage}
        projectId={project.id}
        swarms={swarms ?? []}
        onRunning={() => activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onTasks={() => lanesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <PlanComposer projectId={project.id} />
      {fresh ? (
        <Onboarding />
      ) : (
        <>
          <div ref={activityRef} className="scroll-mt-3">
            <ActivityTimeline swarms={swarms ?? []} />
          </div>
          <div ref={lanesRef} className="scroll-mt-3">
            <Lanes projectId={project.id} projectName={project.name} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary strip

function SummaryStrip({ stage, projectId, swarms, onRunning, onTasks }: { stage: Stage; projectId: string; swarms: Swarm[]; onRunning: () => void; onTasks: () => void }) {
  const { runs, jobs, tasks, deliverables, media } = useMissionData();
  const issues = useIssues();
  const running = runs.filter((r) => r.status === "running").length + jobs.filter((j) => j.status === "running" || j.status === "queued").length + swarms.filter(isActive).length;
  const open = tasks.filter((t) => t.status !== "done").length;
  const errors = issues.filter((i) => i.severity === "error").length;
  const stats: { label: string; n: number; icon: LucideIcon; tone: string; live?: boolean; onClick: () => void; title: string }[] = [
    { label: "Running", n: running, icon: Zap, tone: "var(--accent)", live: running > 0, onClick: onRunning, title: "Agents, swarms and media jobs working now" },
    { label: "Open tasks", n: open, icon: ListTodo, tone: "var(--fg-muted)", onClick: onTasks, title: "Tasks not done yet" },
    { label: "Issues", n: issues.length, icon: CircleAlert, tone: errors ? "var(--err)" : issues.length ? "var(--warn)" : "var(--fg-muted)", onClick: () => showWorkspace("issues"), title: "Open Issues" },
    { label: "Outputs", n: deliverables.length + media.length, icon: PackageOpen, tone: "var(--ok)", onClick: () => showWorkspace("output"), title: "Open Output" },
  ];
  return (
    <div className="rx-card rx-in overflow-hidden">
      <StageBar stage={stage} projectId={projectId} />
      <div className="grid grid-cols-4 border-t border-line">
        {stats.map((s, i) => (
          <button
            key={s.label}
            className={`rx-press group flex min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-hover ${i ? "border-l border-line" : ""}`}
            onClick={s.onClick}
            title={s.title}
          >
            <span className="flex items-center gap-1.5 text-[18px] font-semibold leading-tight tabular-nums" style={{ color: s.n ? (s.label === "Open tasks" ? "var(--fg)" : s.tone) : "var(--fg-faint)" }}>
              {s.live ? <StatusDot color={s.tone} live /> : null}
              {s.n}
            </span>
            <span className="flex w-full items-center gap-1 truncate text-[11px] text-muted group-hover:text-fg">
              <s.icon size={11} className="shrink-0" /> <span className="truncate">{s.label}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StageBar({ stage, projectId }: { stage: Stage; projectId: string }) {
  const [saving, setSaving] = useState<Stage | null>(null);
  const current = STAGES.indexOf(stage);
  const set = async (s: Stage) => {
    if (s === stage || saving) return;
    setSaving(s);
    const st = useWorkbench.getState();
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", json: { stage: s } });
      await st.loadProjects();
      st.log("ok", "project", `Stage set to ${s}`);
    } catch (e) {
      st.log("error", "project", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="px-3 pb-2.5 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rx-label">Stage</span>
        <span className="text-[12px] font-medium capitalize text-fg">{stage}</span>
        <span className="text-[11px] text-faint">
          {current + 1}/{STAGES.length}
        </span>
      </div>
      <ol className="flex gap-1" aria-label="Project stage">
        {STAGES.map((s, i) => {
          const on = i === current;
          const reached = i <= current;
          return (
            <li key={s} className="min-w-0 flex-1">
              <button
                className="rx-press group flex w-full flex-col gap-1.5 rounded-md py-0.5 text-left"
                aria-current={on ? "step" : undefined}
                aria-label={`Stage ${s}${on ? " (current)" : ""}`}
                title={on ? `Current stage: ${s}` : `Move to ${s}`}
                onClick={() => void set(s)}
              >
                <span
                  className={`block h-1.5 w-full rounded-full transition-[background-color,box-shadow] duration-300 ${saving === s ? "rx-indeterminate bg-line" : ""}`}
                  style={
                    saving === s
                      ? undefined
                      : {
                          background: reached ? (on ? "var(--accent)" : "color-mix(in srgb, var(--accent) 55%, transparent)") : "var(--border)",
                          boxShadow: on ? "0 0 10px color-mix(in srgb, var(--accent) 55%, transparent)" : undefined,
                        }
                  }
                />
                <span className={`truncate text-[10.5px] capitalize ${on ? "font-semibold text-fg" : reached ? "text-muted" : "text-faint"} group-hover:text-fg`}>{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- plan a goal

function PlanComposer({ projectId }: { projectId: string }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<"plan" | "swarm" | null>(null);
  const { refresh } = useMissionData();
  const g = goal.trim();
  const plan = async () => {
    if (!g || busy) return;
    setBusy("plan");
    const s = useWorkbench.getState();
    try {
      const created = await api<Task[]>("/api/plan", { method: "POST", json: { projectId, goal: g } });
      s.log("ok", "plan", `Planned ${created.length} tasks`);
      setGoal("");
      s.bump();
      refresh();
    } catch (e) {
      s.log("error", "plan", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const swarm = async () => {
    if (!g || busy) return;
    setBusy("swarm");
    try {
      if (await createSwarm({ projectId, goal: g, autoStart: false })) setGoal("");
    } finally {
      setBusy(null);
    }
  };
  return (
    <form
      className="rx-composer rx-in p-3"
      style={{ ["--i" as string]: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        void plan();
      }}
    >
      <label htmlFor={`plan-${projectId}`} className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold">
        <Wand2 size={13} className="text-accent" /> Plan a goal
      </label>
      <textarea
        id={`plan-${projectId}`}
        rows={2}
        className="block w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-faint"
        style={{ outline: "none" }}
        placeholder="e.g. Launch a paid tier with Stripe by next month"
        value={goal}
        disabled={!!busy}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void (e.metaKey || e.ctrlKey ? swarm() : plan());
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
          <span className="kbd">↵</span> plan tasks · <span className="kbd">⌘↵</span> swarm
        </span>
        <button
          type="button"
          className="rx-press flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elev px-3 text-[12px] text-fg hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] disabled:opacity-45"
          disabled={!g || !!busy}
          onClick={() => void swarm()}
          title="Several departments work on this goal in parallel (you review the plan before it runs)"
        >
          {busy === "swarm" ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />} Run as swarm
        </button>
        <button type="submit" className="rx-primary rx-press h-8 rounded-lg px-3 text-[12px]" disabled={!g || !!busy} title="The Chief of Staff breaks the goal into tasks for every department">
          {busy === "plan" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {busy === "plan" ? "Planning…" : "Generate plan"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- onboarding

function Onboarding() {
  const steps: { n: number; title: string; hint: string; icon: LucideIcon; action?: { label: string; run: () => void } }[] = [
    { n: 1, title: "Plan a goal", hint: "Describe an outcome above. The Chief of Staff turns it into tasks for every department.", icon: Wand2 },
    {
      n: 2,
      title: "Delegate or swarm",
      hint: "Hand a task to one department, or let several work on it in parallel.",
      icon: Send,
      action: { label: "Start a swarm", run: () => openSwarmList(true) },
    },
    { n: 3, title: "Ship & track", hint: "Watch work here, review output, and fix anything flagged in Issues.", icon: Rocket, action: { label: "Open Output", run: () => showWorkspace("output") } },
  ];
  return (
    <section aria-label="Get started" className="rx-card rx-in relative overflow-hidden p-4" style={{ ["--i" as string]: 2 }}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_18%,transparent),transparent)]" aria-hidden />
      <div className="text-[14px] font-semibold tracking-tight">Get your company moving</div>
      <ol className="mt-3 space-y-1">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3 rounded-lg px-1 py-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-editor text-[11px] font-semibold tabular-nums text-accent">{s.n}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                <s.icon size={13} className="text-faint" /> {s.title}
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{s.hint}</p>
            </div>
            {s.action && (
              <button className="rx-press shrink-0 rounded-md px-2 py-1 text-[11.5px] text-accent hover:bg-hover" onClick={s.action.run}>
                {s.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- activity

interface ActivityItem {
  key: string;
  dept: { icon: string; color: string; name: string } | null;
  icon?: LucideIcon;
  title: string;
  sub: string;
  status: "running" | "queued" | "planned" | "done" | "error" | "cancelled";
  at: number;
  time: string;
  progress?: number;
  swarm?: Swarm;
  open: () => void;
}

const STATUS_TONE: Record<ActivityItem["status"], { color: string; label: string }> = {
  running: { color: "var(--accent)", label: "Running" },
  queued: { color: "var(--fg-faint)", label: "Queued" },
  planned: { color: "var(--warn)", label: "Ready to run" },
  done: { color: "var(--ok)", label: "Done" },
  error: { color: "var(--err)", label: "Failed" },
  cancelled: { color: "var(--fg-faint)", label: "Cancelled" },
};

/** Short follow-ups ("retry", "ok", "continue") say nothing on their own — show the conversation's title instead. */
/** The Chief of Staff's swarm-planning run (lib/swarms.ts) — the swarm row already represents it. */
const SWARM_PLANNER = /^Plan an agent swarm for this goal\./;
const TRIVIAL = /^(retry|try again|again|continue|go|go on|ok|okay|yes|y|no|n|next|more|done|thanks|thank you|fix|redo)[.!?\s]*$/i;

function ActivityTimeline({ swarms }: { swarms: Swarm[] }) {
  const { runs, jobs, threads } = useMissionData();
  const project = useActiveProject();
  const { getDepartment } = useDepartments();
  const agents = useAgents();
  const now = useNow();
  const [all, setAll] = useState(false);

  const items = useMemo<ActivityItem[]>(() => {
    const out: ActivityItem[] = [];
    const titleOf = new Map(threads.map((t) => [t.thread_id, t.title]));
    const openRun = (r: Run) => {
      if (r.thread_id) {
        focusConversation();
        useWorkbench.getState().openConversation({ department: r.department, threadId: r.thread_id });
      } else openPage({ kind: "run", id: r.id }, `Run · ${getDepartment(r.department).name}`);
    };
    // One row per conversation (its latest run), so retries and follow-ups don't flood the list.
    const seen = new Set<string>();
    for (const r of runs) {
      if (!r.thread_id && SWARM_PLANNER.test(r.brief)) continue; // shown as its swarm
      const key = r.thread_id ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = getDepartment(r.department);
      const brief = briefTitle(r.brief, 90);
      const title = brief.length < 14 || TRIVIAL.test(brief) ? briefTitle(titleOf.get(r.thread_id ?? "") ?? brief, 90) : brief;
      const status = r.status === "running" ? "running" : r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "error";
      out.push({
        key: `run:${r.id}`,
        dept: d,
        title,
        sub: `${d.name} · ${agents.label(r.provider)}`,
        status,
        at: r.status === "running" ? now : (r.finished_at ?? r.created_at),
        time: r.status === "running" ? elapsed(r.created_at, now) : timeAgo(r.finished_at ?? r.created_at),
        open: () => openRun(r),
      });
    }
    for (const j of jobs) {
      if (j.project_id && j.project_id !== project?.id) continue;
      if (j.status !== "running" && j.status !== "queued") continue;
      out.push({
        key: `job:${j.id}`,
        dept: null,
        icon: j.kind === "video" ? Film : Mic,
        title: j.title,
        sub: `${j.kind} · ${j.status === "queued" ? "queued" : j.step || "working"}`,
        status: j.status === "queued" ? "queued" : "running",
        at: now,
        time: `${Math.round(j.progress)}%`,
        progress: j.progress,
        open: () => openPage({ kind: "create", jobId: j.id }, "Create Studio"),
      });
    }
    for (const s of swarms) {
      const active = isActive(s);
      if (!active && s.status !== "planned" && !(s.finished_at && now - s.finished_at < RECENT_SWARM_MS)) continue;
      const { done, total } = progressOf(s);
      const status = active ? "running" : s.status === "planned" ? "planned" : s.status === "done" ? "done" : s.status === "cancelled" ? "cancelled" : "error";
      out.push({
        key: `swarm:${s.id}`,
        dept: null,
        icon: Network,
        title: briefTitle(s.goal, 90),
        sub: `Swarm · ${SWARM_META[s.status].label}${total ? ` · ${done}/${total} steps` : ""}`,
        status,
        at: active || s.status === "planned" ? now : (s.finished_at ?? s.created_at),
        time: active ? elapsed(s.created_at, now) : timeAgo(s.finished_at ?? s.created_at),
        swarm: s,
        open: () => openSwarm(s),
      });
    }
    const live = (i: ActivityItem) => (i.status === "running" || i.status === "queued" || i.status === "planned" ? 0 : 1);
    return out.sort((a, b) => live(a) - live(b) || b.at - a.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agents/getDepartment are recreated per render
  }, [runs, jobs, threads, swarms, project?.id, now]);

  const liveCount = items.filter((i) => i.status === "running" || i.status === "queued").length;
  const shown = all ? items : items.slice(0, Math.max(TIMELINE_CAP, liveCount));

  return (
    <Section title="Activity" count={liveCount} action={<SectionAction icon={Network} onClick={() => openSwarmList()}>Swarms</SectionAction>}>
      {!items.length ? (
        <p className="rounded-[var(--rx-r-md)] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">Quiet for now. Plan a goal or delegate a task to get work moving.</p>
      ) : (
        <ol className="relative">
          <span className="absolute bottom-4 left-[21px] top-4 w-px bg-line" aria-hidden />
          {shown.map((it, i) => (
            <li key={it.key} className="rx-in relative" style={{ ["--i" as string]: Math.min(i, 8) }}>
              <TimelineRow item={it} />
            </li>
          ))}
        </ol>
      )}
      {items.length > shown.length || all ? (
        <button className="rx-press mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-hover hover:text-fg" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          <ChevronDown size={12} className={`transition-transform ${all ? "rotate-180" : ""}`} /> {all ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </Section>
  );
}

function TimelineRow({ item }: { item: ActivityItem }) {
  const tone = STATUS_TONE[item.status];
  const live = item.status === "running";
  const Icon = item.icon;
  return (
    <button className="rx-press group flex w-full items-start gap-3 rounded-[var(--rx-r-sm)] px-2 py-2 text-left hover:bg-hover" onClick={item.open} title={item.title}>
      <span className="relative z-10 mt-px rounded-[30%] bg-panel">
        {item.dept ? (
          <DeptAvatar dept={item.dept} size={28} />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-[30%] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]">{Icon && <Icon size={14} />}</span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full p-[2px] ring-0" style={{ background: "var(--bg-panel)" }}>
          <StatusDot color={tone.color} live={live} className="!h-[7px] !w-[7px]" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] leading-snug ${live ? "font-medium text-fg" : "text-fg"}`}>{item.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-faint">
          <span className="truncate">{item.sub}</span>
          {item.status !== "done" && item.status !== "running" && (
            <span className="shrink-0 font-medium" style={{ color: tone.color }}>
              {tone.label}
            </span>
          )}
        </span>
        {item.swarm && (item.status === "running" || item.status === "planned") && <StepBar swarm={item.swarm} className="mt-1.5" />}
        {item.progress !== undefined && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)}>
            <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, item.progress)}%` }} />
          </span>
        )}
      </span>
      <span className={`mt-0.5 flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${live ? "text-accent" : "text-faint"}`}>
        {live && <Loader2 size={11} className="animate-spin" />}
        {item.time}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- lanes

function Lanes({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { tasks } = useMissionData();
  const byStatus = useMemo(() => {
    const m = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>;
    for (const t of tasks) (m[t.status] ?? m.backlog).push(t);
    return m;
  }, [tasks]);
  const firstActive = (["doing", "review", "todo", "backlog", "done"] as TaskStatus[]).find((s) => byStatus[s].length) ?? "todo";
  const [lane, setLane] = useState<TaskStatus | null>(null);
  const shown = lane ?? firstActive;
  const total = tasks.length;
  const openBoard = () => openPage({ kind: "board", projectId }, `${projectName} · Board`);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = TASK_STATUSES.indexOf(shown);
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -2;
    if (n < -1) return;
    const next = TASK_STATUSES[(n + TASK_STATUSES.length) % TASK_STATUSES.length];
    e.preventDefault();
    setLane(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Section title="Work" count={total - byStatus.done.length} action={<SectionAction icon={SquareKanban} onClick={openBoard}>Board</SectionAction>}>
      {!total ? (
        <p className="rounded-[var(--rx-r-md)] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">No tasks yet. Generate a plan above and they land here.</p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1 rounded-[var(--rx-r-md)] border border-line bg-editor p-1" role="tablist" aria-label="Work lanes" onKeyDown={onKey}>
            {TASK_STATUSES.map((s) => {
              const on = shown === s;
              const n = byStatus[s].length;
              return (
                <button
                  key={s}
                  ref={(el) => {
                    tabRefs.current[s] = el;
                  }}
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  className={`rx-press flex min-w-0 flex-col items-start gap-1 rounded-[7px] px-2 py-1.5 text-left transition-colors ${on ? "bg-elev shadow-[var(--rx-hairline),var(--rx-shadow-1)]" : "hover:bg-hover"}`}
                  onClick={() => setLane(s)}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LANE_COLOR[s] }} aria-hidden />
                    <span className={`truncate text-[11px] ${on ? "font-medium text-fg" : "text-muted"}`}>{STATUS_LABEL[s]}</span>
                  </span>
                  <span className={`text-[15px] font-semibold leading-none tabular-nums ${n ? "text-fg" : "text-faint"}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex h-1 gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {TASK_STATUSES.map((s) => (byStatus[s].length ? <span key={s} className="h-full transition-[flex-grow] duration-500" style={{ flexGrow: byStatus[s].length, background: LANE_COLOR[s] }} /> : null))}
          </div>
          <ul key={shown} className="mt-3 space-y-1.5" role="tabpanel" aria-label={STATUS_LABEL[shown]}>
            {byStatus[shown].slice(0, 6).map((t, i) => (
              <TaskCard key={t.id} task={t} index={i} />
            ))}
            {!byStatus[shown].length && <li className="px-1 py-2 text-[12.5px] text-muted">Nothing in {STATUS_LABEL[shown].toLowerCase()}.</li>}
          </ul>
          {byStatus[shown].length > 6 && (
            <button className="rx-press mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-accent hover:bg-hover" onClick={openBoard}>
              {byStatus[shown].length - 6} more on the board <ArrowRight size={12} />
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function TaskCard({ task, index }: { task: Task; index: number }) {
  const { getDepartment } = useDepartments();
  const d = getDepartment(task.department);
  const [swarming, setSwarming] = useState(false);
  const swarm = async () => {
    setSwarming(true);
    try {
      await swarmTask(task);
    } finally {
      setSwarming(false);
    }
  };
  const delegate = () => {
    focusConversation();
    useWorkbench.getState().delegate({ department: task.department, brief: task.detail ? `${task.title}\n\n${task.detail}` : task.title, taskId: task.id });
  };
  const act = "rx-press flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[11.5px] text-muted hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] hover:text-fg";
  return (
    <li className="rx-card rx-hover rx-in group flex items-center gap-3 px-3 py-2.5" style={{ ["--i" as string]: index }}>
      <DeptAvatar dept={d} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] leading-snug" title={task.title}>
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
          <span className="truncate">{d.name}</span>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[task.priority] }} aria-hidden />
          <span className="capitalize">{task.priority}</span>
        </div>
      </div>
      {task.status !== "done" && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 max-[1199px]:opacity-100">
          <button className={act} onClick={() => void swarm()} disabled={swarming} title="Run a swarm on this task (several departments in parallel)">
            {swarming ? <Loader2 size={11} className="animate-spin" /> : <Network size={11} />} Swarm
          </button>
          <button className={act} onClick={delegate} title={`Delegate to ${d.name}`}>
            <Send size={11} /> Delegate
          </button>
        </div>
      )}
    </li>
  );
}

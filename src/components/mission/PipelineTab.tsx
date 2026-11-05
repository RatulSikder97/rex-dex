"use client";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Film, Loader2, Mic, Network, Rocket, Send, Sparkles, SquareKanban, Wand2, Workflow, type LucideIcon } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { STAGES, TASK_STATUSES, type Priority, type Run, type Stage, type Task, type TaskStatus } from "@/lib/types";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { createSwarm, isActive, openSwarm, openSwarmList, useSwarms, type Swarm } from "@/components/swarm/api";
import { StepBar, SWARM_META, progressOf } from "@/components/swarm/ui";
import { swarmTask } from "@/components/swarm/api";
import { ErrorState, LoadingRows, Tabs } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { briefTitle, elapsed, useMissionData, useNow } from "./data";
import { useIssues } from "./IssuesTab";
import { focusConversation, openPage, showWorkspace } from "./nav";
import { DeptAvatar, Section, SectionAction, StatusDot } from "./ui";

const STATUS_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", todo: "To do", doing: "Doing", review: "Review", done: "Done" };
const PRIORITY_COLOR: Record<Priority, string> = { urgent: "var(--err)", high: "var(--warn)", medium: "var(--accent)", low: "var(--fg-faint)" };
const RECENT_SWARM_MS = 12 * 3600_000;
const TIMELINE_CAP = 5;
const LANE_CAP = 8;

/** Reload everything the pipeline shows (mission poller + swarms, both keyed on the store version). */
const reloadAll = (refresh: () => void) => {
  useWorkbench.getState().bump();
  refresh();
};

/** Pipeline ("Mission board"): stage + stats → plan a goal → one activity list → work lanes. */
export default function PipelineTab() {
  const project = useActiveProject();
  const { runs, jobs, tasks, loaded } = useMissionData();
  const { swarms, error: swarmError } = useSwarms(project?.id);
  const lanesRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  if (!project) return null;
  const projectJobs = jobs.filter((j) => !j.project_id || j.project_id === project.id);
  const fresh = loaded && swarms !== null && !swarmError && !tasks.length && !runs.length && !(swarms ?? []).length && !projectJobs.some((j) => j.status === "running" || j.status === "queued");

  return (
    <div className="@container space-y-6 px-4 pb-6 pt-3">
      <SummaryStrip
        stage={project.stage}
        projectId={project.id}
        swarms={swarms ?? []}
        loaded={loaded}
        onRunning={() => activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onTasks={() => lanesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <PlanComposer projectId={project.id} />
      {fresh ? (
        <Onboarding />
      ) : (
        <>
          <div ref={activityRef} className="scroll-mt-3">
            <ActivityTimeline swarms={swarms ?? []} loading={!loaded || swarms === null} error={swarmError} />
          </div>
          <div ref={lanesRef} className="scroll-mt-3">
            <Lanes projectId={project.id} projectName={project.name} loading={!loaded} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary strip

function SummaryStrip({ stage, projectId, swarms, loaded, onRunning, onTasks }: { stage: Stage; projectId: string; swarms: Swarm[]; loaded: boolean; onRunning: () => void; onTasks: () => void }) {
  const { runs, jobs, tasks, deliverables, media } = useMissionData();
  const issues = useIssues();
  const running = runs.filter((r) => r.status === "running").length + jobs.filter((j) => j.status === "running" || j.status === "queued").length + swarms.filter(isActive).length;
  const open = tasks.filter((t) => t.status !== "done").length;
  const errors = issues.filter((i) => i.severity === "error").length;
  const stats: { label: string; n: number; tone?: string; live?: boolean; onClick: () => void; title: string }[] = [
    { label: "Running", n: running, tone: running ? "var(--accent)" : undefined, live: running > 0, onClick: onRunning, title: "Agents, swarms and media jobs working now" },
    { label: "Open tasks", n: open, onClick: onTasks, title: "Tasks not done yet" },
    { label: "Issues", n: issues.length, tone: errors ? "var(--err)" : issues.length ? "var(--warn)" : undefined, onClick: () => showWorkspace("issues"), title: "Open Issues" },
    { label: "Outputs", n: deliverables.length + media.length, onClick: () => showWorkspace("output"), title: "Open Output" },
  ];
  return (
    <section aria-label="Project status" className="space-y-3">
      <StageBar stage={stage} projectId={projectId} />
      {loaded ? (
        <div className="-mx-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
          {stats.map((s) => (
            <button key={s.label} type="button" className="flex h-6 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={s.onClick} title={s.title}>
              {s.live && <StatusDot color="var(--accent)" live />}
              <span>{s.label}</span>
              <span className={`font-semibold tabular-nums ${s.n ? "" : "text-faint"}`} style={s.n && s.tone ? { color: s.tone } : s.n ? { color: "var(--fg)" } : undefined}>
                {s.n}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Skeleton className="h-6 w-72 max-w-full" />
      )}
    </section>
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
    <div>
      <div className="mb-1.5 flex h-6 items-center gap-2">
        <h3 className="rx-label">Stage</h3>
        <span className="text-[12px] font-medium capitalize text-fg">{stage}</span>
        <span className="text-[11px] tabular-nums text-faint">
          {current + 1} of {STAGES.length}
        </span>
      </div>
      <ol className="flex gap-[2px]" aria-label="Project stage">
        {STAGES.map((s, i) => {
          const on = i === current;
          const reached = i <= current;
          return (
            <li key={s} className="min-w-0 flex-1">
              <button
                type="button"
                className="group flex w-full flex-col gap-1 rounded-[2px] text-left"
                aria-current={on ? "step" : undefined}
                aria-label={`Stage ${s}${on ? " (current)" : ""}`}
                title={on ? `Current stage: ${s}` : `Move to ${s}`}
                onClick={() => void set(s)}
              >
                <span
                  className={`block h-1 w-full rounded-[1px] transition-colors ${saving === s ? "rx-indeterminate bg-line" : ""} ${!reached && saving !== s ? "group-hover:!bg-[color:color-mix(in_srgb,var(--fg-faint)_55%,var(--border))]" : ""}`}
                  style={saving === s ? undefined : { background: reached ? (on ? "var(--accent)" : "color-mix(in srgb, var(--accent) 50%, var(--border))") : "var(--border)" }}
                />
                <span className={`truncate text-[11px] capitalize ${on ? "font-medium text-fg" : reached ? "text-muted" : "text-faint"} group-hover:text-fg`}>{s}</span>
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
      aria-labelledby={`plan-h-${projectId}`}
      onSubmit={(e) => {
        e.preventDefault();
        void plan();
      }}
    >
      <header className="mb-2 flex h-6 items-center gap-2">
        <h3 id={`plan-h-${projectId}`} className="rx-label">
          <label htmlFor={`plan-${projectId}`}>Plan a goal</label>
        </h3>
      </header>
      <textarea
        id={`plan-${projectId}`}
        rows={3}
        className="input block resize-none text-[13px]"
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
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto min-w-0 truncate text-[11px] text-faint">
          <span className="kbd">↵</span> plan tasks · <span className="kbd">⌘↵</span> swarm
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!g || !!busy}
          onClick={() => void swarm()}
          title="Several departments work on this goal in parallel (you review the plan before it runs) (⌘↵)"
        >
          {busy === "swarm" ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />} Run as swarm
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!g || !!busy} title="The Chief of Staff breaks the goal into tasks for every department (↵)">
          {busy === "plan" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {busy === "plan" ? "Planning…" : "Generate plan"}
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
    { n: 3, title: "Ship and track", hint: "Watch work here, review output, and fix anything flagged in Issues.", icon: Rocket, action: { label: "Open output", run: () => showWorkspace("output") } },
  ];
  return (
    <Section title="Get started">
      <ol className="card divide-y divide-[color:var(--border)]">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3 px-3 py-2.5">
            <span className="count mt-px !h-5 !min-w-5 !text-[11px]">{s.n}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{s.title}</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{s.hint}</p>
            </div>
            {s.action && (
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={s.action.run}>
                {s.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </Section>
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

/** The Chief of Staff's swarm-planning run (lib/swarms.ts) — the swarm row already represents it. */
const SWARM_PLANNER = /^Plan an agent swarm for this goal\./;
/** Short follow-ups ("retry", "ok", "continue") say nothing on their own — show the task's title instead. */
const TRIVIAL = /^(retry|try again|again|continue|go|go on|ok|okay|yes|y|no|n|next|more|done|thanks|thank you|fix|redo)[.!?\s]*$/i;

function ActivityTimeline({ swarms, loading, error }: { swarms: Swarm[]; loading: boolean; error: string | null }) {
  const { runs, jobs, threads, refresh } = useMissionData();
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
    // One row per task (its latest run), so retries and follow-ups don't flood the list.
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
      {loading && !items.length ? (
        <LoadingRows rows={4} height={24} />
      ) : error && !items.length ? (
        <ErrorState compact title="Couldn’t load swarms" error={`${error}. Check that REX is running, then retry.`} onRetry={() => reloadAll(refresh)} />
      ) : !items.length ? (
        <EmptyState compact icon={Workflow} title="Quiet for now" hint="Plan a goal or delegate a task to get work moving." />
      ) : (
        <ol className="-mx-4">
          {shown.map((it) => (
            <li key={it.key}>
              <TimelineRow item={it} />
            </li>
          ))}
        </ol>
      )}
      {items.length > shown.length || all ? (
        <button type="button" className="btn btn-ghost btn-sm -ml-2 mt-1" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          <ChevronDown size={12} className={all ? "rotate-180" : ""} /> {all ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </Section>
  );
}

function TimelineRow({ item }: { item: ActivityItem }) {
  const tone = STATUS_TONE[item.status];
  const live = item.status === "running";
  const Icon = item.icon;
  const bar = (item.swarm && (item.status === "running" || item.status === "planned")) || item.progress !== undefined;
  return (
    <button type="button" className="flex min-h-8 w-full items-center gap-2.5 px-4 py-1 text-left hover:bg-hover focus-visible:outline-offset-[-1px]" onClick={item.open} title={item.title}>
      <span className="relative shrink-0">
        {item.dept ? (
          <DeptAvatar dept={item.dept} size={20} />
        ) : (
          <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">{Icon && <Icon size={12} />}</span>
        )}
        <span className="absolute -bottom-[3px] -right-[3px] rounded-full p-[1.5px]" style={{ background: "var(--bg-panel)" }}>
          <StatusDot color={tone.color} live={live} className="!h-[6px] !w-[6px]" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={`min-w-0 truncate text-[13px] ${live ? "font-medium" : ""}`}>{item.title}</span>
          <span className="hidden shrink-0 truncate text-[11px] text-faint @xl:inline">{item.sub}</span>
        </span>
        {bar && (
          <span className="mt-1 block">
            {item.swarm && (item.status === "running" || item.status === "planned") && <StepBar swarm={item.swarm} />}
            {item.progress !== undefined && (
              <span className="block h-1 overflow-hidden rounded-[1px] bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)} aria-label="Progress">
                <span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, item.progress)}%` }} />
              </span>
            )}
          </span>
        )}
      </span>
      {item.status !== "done" && item.status !== "running" && (
        <span className="shrink-0 text-[11px] font-medium" style={{ color: tone.color }}>
          {tone.label}
        </span>
      )}
      <span className={`flex w-14 shrink-0 items-center justify-end gap-1 text-[11px] tabular-nums ${live ? "text-accent" : "text-faint"}`}>
        {live && <Loader2 size={11} className="animate-spin" />}
        {item.time}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- lanes

function Lanes({ projectId, projectName, loading }: { projectId: string; projectName: string; loading: boolean }) {
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

  return (
    <Section title="Work" count={total - byStatus.done.length} action={<SectionAction icon={SquareKanban} onClick={openBoard}>Board</SectionAction>}>
      {loading && !total ? (
        <LoadingRows rows={3} height={24} />
      ) : !total ? (
        <EmptyState compact icon={SquareKanban} title="No tasks yet" hint="Generate a plan above and its tasks land here." />
      ) : (
        <>
          <Tabs
            label="Work lanes"
            idPrefix={`lane-${projectId}`}
            value={shown}
            onChange={setLane}
            tabs={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], badge: byStatus[s].length ? <span className="count">{byStatus[s].length}</span> : undefined }))}
          />
          <ul className="-mx-4 mt-1" role="tabpanel" aria-labelledby={`lane-${projectId}-${shown}`}>
            {byStatus[shown].slice(0, LANE_CAP).map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
            {!byStatus[shown].length && <li className="px-4 py-2 text-[12px] text-muted">Nothing in {STATUS_LABEL[shown].toLowerCase()}.</li>}
          </ul>
          {byStatus[shown].length > LANE_CAP && (
            <button type="button" className="btn btn-ghost btn-sm -ml-2 mt-1" onClick={openBoard}>
              {byStatus[shown].length - LANE_CAP} more on the board <ArrowRight size={12} />
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function TaskRow({ task }: { task: Task }) {
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
  return (
    <li className="group relative flex h-8 items-center gap-2.5 px-4 hover:bg-hover">
      <DeptAvatar dept={d} size={20} />
      <span className="min-w-0 flex-1 truncate text-[13px]" title={task.title}>
        {task.title}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint" title={`${d.name} · ${task.priority} priority`}>
        <span className="hidden max-w-[120px] truncate @md:inline">{d.name}</span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[task.priority] }} aria-hidden />
        <span className="capitalize">{task.priority}</span>
      </span>
      {task.status !== "done" && (
        <span className="absolute inset-y-0 right-0 flex items-center gap-1 bg-hover pl-3 pr-4 opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
          <button type="button" className="btn btn-sm" onClick={() => void swarm()} disabled={swarming} title="Run a swarm on this task (several departments in parallel)">
            {swarming ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />} Swarm
          </button>
          <button type="button" className="btn btn-sm" onClick={delegate} title={`Delegate to ${d.name}`}>
            <Send size={12} /> Delegate
          </button>
        </span>
      )}
    </li>
  );
}

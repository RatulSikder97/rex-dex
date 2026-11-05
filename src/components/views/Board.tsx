"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronsLeftRight, ChevronsRightLeft, FolderX, Loader2, Network, Plus, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { PRIORITIES, TASK_STATUSES, type Task, type TaskStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useWorkbench, useDepartments } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";
import { openSwarm, swarmTask, useSwarms } from "@/components/swarm/api";
import { ErrorState, Pill, type Tone } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";

const COLUMN_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", todo: "To do", doing: "In progress", review: "Review", done: "Done" };
const PRIORITY_COLOR: Record<string, string> = { low: "var(--fg-faint)", medium: "var(--accent)", high: "var(--warn)", urgent: "var(--err)" };
const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const COLUMN_COLOR: Record<TaskStatus, string> = { backlog: "var(--fg-faint)", todo: "var(--fg-muted)", doing: "var(--warn)", review: "var(--accent)", done: "var(--ok)" };
const SWARM_TONE: Record<string, Tone> = { done: "ok", error: "err", cancelled: "neutral" };
/** Cards rendered per column before "Show more" (columns can hold hundreds of tasks). */
const PAGE = 100;

export default function Board({ projectId }: { projectId: string }) {
  const { departments: DEPARTMENTS, getDepartment } = useDepartments();
  const { projects, version, bump, log, delegate } = useWorkbench();
  const project = projects.find((p) => p.id === projectId);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [limit, setLimit] = useState<Partial<Record<TaskStatus, number>>>({});
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<TaskStatus | null>(null);
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const { swarms } = useSwarms(projectId);
  const [swarming, setSwarming] = useState<string | null>(null);
  /** Latest swarm per task (list is newest first). */
  const swarmByTask = new Map<string, NonNullable<typeof swarms>[number]>();
  for (const sw of swarms ?? []) if (sw.task_id && !swarmByTask.has(sw.task_id)) swarmByTask.set(sw.task_id, sw);
  const startSwarm = async (t: Task) => {
    setSwarming(t.id);
    try {
      await swarmTask(t);
    } finally {
      setSwarming(null);
    }
  };
  // Columns the user collapsed/expanded explicitly; otherwise "Done" auto-collapses when the board is narrow.
  const [collapsedPref, setCollapsedPref] = useState<Partial<Record<TaskStatus, boolean>>>(() => {
    try {
      return JSON.parse(localStorage.getItem("rex-board-collapsed") ?? "{}");
    } catch {
      return {};
    }
  });
  const colsRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = colsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isCollapsed = (st: TaskStatus) => collapsedPref[st] ?? (narrow && st === "done");
  const setCollapsed = (st: TaskStatus, v: boolean) =>
    setCollapsedPref((c) => {
      const next = { ...c, [st]: v };
      try {
        localStorage.setItem("rex-board-collapsed", JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });

  const load = useCallback(
    () =>
      api<Task[]>(`/api/tasks?projectId=${projectId}`)
        .then((ts) => {
          setTasks(ts);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e)),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load, version]);

  const patch = async (id: string, p: Partial<Task>) => {
    setTasks((ts) => ts && ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    await api(`/api/tasks/${id}`, { method: "PATCH", json: p }).catch((e) => log("error", "board", String(e)));
  };

  const add = async (status: TaskStatus) => {
    const title = quickAdd[status]?.trim();
    if (!title) return;
    try {
      await api("/api/tasks", { method: "POST", json: { projectId, tasks: [{ title, status, department: deptFilter === "all" ? "engineering" : deptFilter }] } });
    } catch (e) {
      log("error", "board", `Couldn’t add the task: ${String(e)}`);
      return;
    }
    setQuickAdd((q) => ({ ...q, [status]: "" }));
    load();
    bump();
  };

  const generate = async () => {
    if (!goal.trim()) return;
    setPlanning(true);
    log("info", "plan", `Planning: ${goal.slice(0, 80)}`);
    try {
      const created = await api<Task[]>("/api/plan", { method: "POST", json: { projectId, goal } });
      log("ok", "plan", `Generated ${created.length} tasks`);
      setGoal("");
      load();
      bump();
    } catch (e) {
      log("error", "plan", String(e));
    } finally {
      setPlanning(false);
    }
  };

  const delegateTask = (t: Task) => {
    delegate({ department: t.department, brief: `Complete this task end-to-end and deliver the finished output:\n\n${t.title}${t.detail ? `\n\n${t.detail}` : ""}`, taskId: t.id });
    if (t.status === "backlog" || t.status === "todo") patch(t.id, { status: "doing" });
  };

  const visible = (tasks ?? []).filter((t) => deptFilter === "all" || t.department === deptFilter);

  if (!project) return <EmptyState icon={FolderX} title="Project not found" hint="It may have been removed. Pick another project from the switcher." />;

  return (
    <div className="flex h-full flex-col">
      <div role="toolbar" aria-label="Board" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="mr-1 min-w-0 max-w-[200px] truncate text-[13px] font-semibold" title={project.name}>
          {project.name}
        </h2>
        <select className="input input-sm w-auto" aria-label="Filter by department" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <input
            className="input input-sm min-w-0"
            aria-label="Goal to plan"
            title="Describe a goal; the Chief of Staff turns it into tasks"
            placeholder="Describe a goal to plan, e.g. “Launch v1 with a landing page and demo video”"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
          />
          <button className="btn btn-primary btn-sm shrink-0" onClick={generate} disabled={planning || !goal.trim()}>
            {planning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {planning ? "Planning…" : "Generate plan"}
          </button>
        </div>
      </div>

      {loadError && !tasks ? (
        <ErrorState title="Couldn’t load the board" error={loadError} onRetry={load} />
      ) : (
      <div ref={colsRef} className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
        {TASK_STATUSES.map((status) => {
          const col = visible.filter((t) => t.status === status);
          const shown = limit[status] ?? PAGE;
          const over = dropCol === status && !!dragId;
          const dropProps = {
            onDragOver: (e: React.DragEvent) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropCol !== status) setDropCol(status);
            },
            onDragLeave: (e: React.DragEvent) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol((c) => (c === status ? null : c));
            },
            onDrop: (e: React.DragEvent) => {
              e.preventDefault();
              const id = dragId ?? e.dataTransfer.getData("text/plain");
              const t = tasks?.find((x) => x.id === id);
              if (t && t.status !== status) patch(t.id, { status });
              setDragId(null);
              setDropCol(null);
            },
          };
          if (isCollapsed(status))
            return (
              <button
                key={status}
                {...dropProps}
                title={`Expand ${COLUMN_LABEL[status]} (${col.length})`}
                aria-label={`Expand ${COLUMN_LABEL[status]} column, ${col.length} tasks`}
                onClick={() => setCollapsed(status, false)}
                className={`flex w-8 shrink-0 flex-col items-center gap-2 rounded-[6px] border bg-side py-2 hover:bg-hover ${over ? "border-accent" : "border-line"}`}
              >
                <ChevronsLeftRight size={13} className="text-faint" aria-hidden />
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLUMN_COLOR[status] }} aria-hidden />
                <span className="count">{col.length}</span>
                <span className="section-title [writing-mode:vertical-rl]">{COLUMN_LABEL[status]}</span>
              </button>
            );
          return (
            <section
              key={status}
              aria-label={`${COLUMN_LABEL[status]} (${col.length})`}
              className={`flex min-w-[168px] flex-1 basis-0 flex-col rounded-[6px] border bg-side transition-colors ${over ? "border-accent" : "border-line"}`}
              {...dropProps}
            >
              <div className="flex h-8 shrink-0 items-center gap-1.5 pl-2.5 pr-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLUMN_COLOR[status] }} aria-hidden />
                <span className="section-title min-w-0 truncate" title={COLUMN_LABEL[status]}>
                  {COLUMN_LABEL[status]}
                </span>
                <span className="count shrink-0">{tasks ? col.length : "–"}</span>
                <button className="icon-btn ml-auto !h-5 !w-5" title={`Collapse ${COLUMN_LABEL[status]}`} aria-label={`Collapse ${COLUMN_LABEL[status]} column`} onClick={() => setCollapsed(status, true)}>
                  <ChevronsRightLeft size={13} />
                </button>
                <button className="icon-btn !h-5 !w-5" title={`Add task to ${COLUMN_LABEL[status]}`} aria-label={`Add task to ${COLUMN_LABEL[status]}`} onClick={() => document.getElementById(`add-${status}`)?.focus()}>
                  <Plus size={13} />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-2">
                {!tasks &&
                  Array.from({ length: status === "backlog" ? 3 : status === "done" ? 0 : 2 }, (_, i) => <Skeleton key={i} className="h-[52px] w-full" />)}
                {col.slice(0, shown).map((t) => {
                  const d = getDepartment(t.department);
                  return (
                    <article
                      key={t.id}
                      draggable
                      tabIndex={0}
                      aria-label={`${t.title}, ${d.name}, ${t.priority} priority`}
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropCol(null);
                      }}
                      onClick={() => setEditing(t)}
                      onKeyDown={(e) => e.key === "Enter" && setEditing(t)}
                      className={`group relative rounded-[4px] border border-line bg-editor py-1.5 pl-2.5 pr-1.5 hover:border-[color-mix(in_srgb,var(--fg-faint)_60%,var(--border))] focus-visible:border-accent ${dragId === t.id ? "opacity-40" : ""}`}
                      style={{ outline: "none" }}
                    >
                      <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-r" style={{ background: PRIORITY_COLOR[t.priority] }} title={`${PRIORITY_LABEL[t.priority] ?? t.priority} priority`} aria-hidden />
                      <div className="line-clamp-3 text-[12.5px] leading-snug" title={t.title}>
                        {t.title}
                      </div>
                      <div className="mt-1 flex h-5 items-center gap-1.5 text-[11px] text-muted">
                        <DeptIcon name={d.icon} color={d.color} size={12} />
                        <span className="min-w-0 truncate" title={d.name}>
                          {d.name}
                        </span>
                        {(t.priority === "high" || t.priority === "urgent") && (
                          <Pill tone={t.priority === "urgent" ? "err" : "warn"} className="shrink-0">
                            {PRIORITY_LABEL[t.priority]}
                          </Pill>
                        )}
                        {(() => {
                          const sw = swarmByTask.get(t.id);
                          if (!sw) return null;
                          const live = sw.status === "running" || sw.status === "planning";
                          const tone = SWARM_TONE[sw.status] ?? "accent";
                          return (
                            <button
                              className={`pill shrink-0 ${tone === "neutral" ? "" : `pill-${tone}`} hover:brightness-110`}
                              title={`Swarm ${sw.status}. Open it`}
                              aria-label={`Open swarm (${sw.status})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openSwarm(sw);
                              }}
                            >
                              <Network size={10} className={live ? "animate-pulse" : ""} /> {sw.steps.length ? `${sw.steps.filter((x) => x.status === "done" || x.status === "skipped").length}/${sw.steps.length}` : "swarm"}
                            </button>
                          );
                        })()}
                        <button
                          className="btn btn-ghost btn-sm ml-auto !h-5 shrink-0 !px-1.5 !text-[11px] opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                          title="Run a swarm on this task (several departments in parallel)"
                          aria-label={`Run a swarm on "${t.title}"`}
                          disabled={swarming === t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void startSwarm(t);
                          }}
                        >
                          {swarming === t.id ? <Loader2 size={12} className="animate-spin" /> : <Network size={12} />} Swarm
                        </button>
                        <button
                          className="btn btn-ghost btn-sm !h-5 shrink-0 !px-1.5 !text-[11px] opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                          title={`Delegate to ${d.name}`}
                          aria-label={`Delegate "${t.title}" to ${d.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            delegateTask(t);
                          }}
                        >
                          <Bot size={12} /> Delegate
                        </button>
                      </div>
                    </article>
                  );
                })}
                {col.length > shown && (
                  <button className="btn btn-ghost btn-sm w-full" onClick={() => setLimit((l) => ({ ...l, [status]: shown + PAGE }))}>
                    Show {Math.min(PAGE, col.length - shown)} more
                  </button>
                )}
                {tasks && !col.length && (
                  <div className={`rounded-[4px] border border-dashed px-2 py-3 text-center text-[11.5px] ${over ? "border-accent text-accent" : "border-line text-faint"}`}>
                    {dragId ? "Drop here" : status === "backlog" ? "Generate a plan or add a task" : "Drag tasks here"}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <input
                    id={`add-${status}`}
                    className="input input-sm !border-transparent bg-transparent hover:!border-line focus:!border-accent"
                    placeholder="+ Add task"
                    aria-label={`New task in ${COLUMN_LABEL[status]}`}
                    value={quickAdd[status] ?? ""}
                    onChange={(e) => setQuickAdd((q) => ({ ...q, [status]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") add(status);
                      if (e.key === "Escape") setQuickAdd((q) => ({ ...q, [status]: "" }));
                    }}
                  />
                  {quickAdd[status] && (
                    <button className="icon-btn" aria-label="Add task" title="Add task (Enter)" onClick={() => add(status)}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      )}

      {editing && (
        <TaskDialog
          task={editing}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            await patch(editing.id, p);
            setEditing(null);
            bump();
          }}
          onDelete={async () => {
            if (!(await confirmDialog({ title: `Delete task "${editing.title}"?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
            try {
              await api(`/api/tasks/${editing.id}`, { method: "DELETE" });
            } catch (e) {
              log("error", "board", `Couldn’t delete the task: ${String(e)}`);
              return;
            }
            setEditing(null);
            load();
            bump();
          }}
          onDelegate={() => {
            delegateTask(editing);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TaskDialog({ task, onClose, onSave, onDelete, onDelegate }: { task: Task; onClose: () => void; onSave: (p: Partial<Task>) => void; onDelete: () => void; onDelegate: () => void }) {
  const { departments: DEPARTMENTS } = useDepartments();
  const [t, setT] = useState(task);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="scrim fixed inset-0 z-40 flex items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" className="popover w-[560px] max-w-[94vw] space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="task-dialog-title" className="text-[13px] font-semibold">
            Edit task
          </h2>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <input className="input text-[13px]" aria-label="Title" autoFocus value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
        <textarea className="input" aria-label="Details" rows={8} placeholder="Details, acceptance criteria…" value={t.detail} onChange={(e) => setT({ ...t, detail: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className="label">Department</span>
            <select className="input" value={t.department} onChange={(e) => setT({ ...t, department: e.target.value })}>
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Status</span>
            <select className="input" value={t.status} onChange={(e) => setT({ ...t, status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {COLUMN_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Priority</span>
            <select className="input" value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value as Task["priority"] })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button className="btn btn-danger-ghost" onClick={onDelete}>
            <Trash2 size={13} /> Delete
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onDelegate} title="Hand this task to its department's agent">
            <Bot size={13} /> Delegate
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ title: t.title, detail: t.detail, department: t.department, status: t.status, priority: t.priority })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

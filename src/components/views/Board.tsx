"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronsLeftRight, ChevronsRightLeft, Loader2, Network, Plus, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { PRIORITIES, TASK_STATUSES, type Task, type TaskStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useWorkbench, useDepartments } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";
import { openSwarm, swarmTask, useSwarms } from "@/components/swarm/api";

const COLUMN_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", todo: "To do", doing: "In progress", review: "Review", done: "Done" };
const PRIORITY_COLOR: Record<string, string> = { low: "var(--fg-faint)", medium: "var(--accent)", high: "var(--warn)", urgent: "var(--err)" };
const COLUMN_COLOR: Record<TaskStatus, string> = { backlog: "var(--fg-faint)", todo: "#61afef", doing: "var(--warn)", review: "#c678dd", done: "var(--ok)" };

export default function Board({ projectId }: { projectId: string }) {
  const { departments: DEPARTMENTS, getDepartment } = useDepartments();
  const { projects, version, bump, log, delegate } = useWorkbench();
  const project = projects.find((p) => p.id === projectId);
  const [tasks, setTasks] = useState<Task[]>([]);
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

  const load = useCallback(() => api<Task[]>(`/api/tasks?projectId=${projectId}`).then(setTasks).catch((e) => log("error", "board", String(e))), [projectId, log]);
  useEffect(() => {
    load();
  }, [load, version]);

  const patch = async (id: string, p: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    await api(`/api/tasks/${id}`, { method: "PATCH", json: p }).catch((e) => log("error", "board", String(e)));
  };

  const add = async (status: TaskStatus) => {
    const title = quickAdd[status]?.trim();
    if (!title) return;
    await api("/api/tasks", { method: "POST", json: { projectId, tasks: [{ title, status, department: deptFilter === "all" ? "engineering" : deptFilter }] } });
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

  const visible = tasks.filter((t) => deptFilter === "all" || t.department === deptFilter);

  if (!project) return <div className="p-6 text-muted">Project not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="mr-2 font-semibold">{project.name}</h2>
        <select className="input h-7 w-auto" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="flex min-w-[320px] flex-1 items-center gap-2">
          <input
            className="input"
            placeholder="Goal → AI plan, e.g. “Launch v1 with landing page, SEO, and a demo video in 3 weeks”"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
          />
          <button className="btn btn-primary" onClick={generate} disabled={planning || !goal.trim()}>
            <Sparkles size={13} /> {planning ? "Planning…" : "Generate plan"}
          </button>
        </div>
      </div>

      <div ref={colsRef} className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto p-2.5">
        {TASK_STATUSES.map((status) => {
          const col = visible.filter((t) => t.status === status);
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
              const t = tasks.find((x) => x.id === id);
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
                className={`flex w-9 shrink-0 flex-col items-center gap-2 rounded-md bg-side py-2 hover:bg-hover ${over ? "shadow-[inset_0_0_0_1px_var(--accent)]" : ""}`}
              >
                <ChevronsLeftRight size={13} className="text-faint" />
                <span className="h-2 w-2 rounded-full" style={{ background: COLUMN_COLOR[status] }} />
                <span className="text-[11px] text-faint">{col.length}</span>
                <span className="text-[12px] font-semibold [writing-mode:vertical-rl]">{COLUMN_LABEL[status]}</span>
              </button>
            );
          return (
            <section
              key={status}
              aria-label={`${COLUMN_LABEL[status]} (${col.length})`}
              className={`flex min-w-[156px] flex-1 basis-0 flex-col rounded-md bg-side transition-shadow ${over ? "shadow-[inset_0_0_0_1px_var(--accent)]" : ""}`}
              {...dropProps}
            >
              <div className="flex items-center gap-2 px-2.5 py-2">
                <span className="h-2 w-2 rounded-full" style={{ background: COLUMN_COLOR[status] }} />
                <span className="min-w-0 truncate whitespace-nowrap text-[12px] font-semibold">{COLUMN_LABEL[status]}</span>
                <span className="shrink-0 text-[11px] text-faint">{col.length}</span>
                <button className="icon-btn ml-auto !h-5 !w-5" title={`Collapse ${COLUMN_LABEL[status]}`} aria-label={`Collapse ${COLUMN_LABEL[status]} column`} onClick={() => setCollapsed(status, true)}>
                  <ChevronsRightLeft size={13} />
                </button>
                <button className="icon-btn !h-5 !w-5" title={`Add task to ${COLUMN_LABEL[status]}`} aria-label={`Add task to ${COLUMN_LABEL[status]}`} onClick={() => document.getElementById(`add-${status}`)?.focus()}>
                  <Plus size={13} />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
                {col.map((t) => {
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
                      className={`group relative cursor-pointer rounded border border-line bg-editor py-1.5 pl-2.5 pr-2 outline-none hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] focus-visible:border-accent ${dragId === t.id ? "opacity-40" : ""}`}
                    >
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r" style={{ background: PRIORITY_COLOR[t.priority] }} title={`${t.priority} priority`} />
                      <div className="line-clamp-3 text-[12.5px] leading-snug">{t.title}</div>
                      <div className="mt-1.5 flex h-5 items-center gap-1.5 text-[11px] text-muted">
                        <DeptIcon name={d.icon} color={d.color} size={12} />
                        <span className="min-w-0 truncate">{d.name}</span>
                        {(t.priority === "high" || t.priority === "urgent") && (
                          <span className="shrink-0 rounded px-1 text-[10px] font-medium uppercase" style={{ color: PRIORITY_COLOR[t.priority], background: `color-mix(in srgb, ${PRIORITY_COLOR[t.priority]} 14%, transparent)` }}>
                            {t.priority}
                          </span>
                        )}
                        {(() => {
                          const sw = swarmByTask.get(t.id);
                          if (!sw) return null;
                          const live = sw.status === "running" || sw.status === "planning";
                          const color = sw.status === "done" ? "var(--ok)" : sw.status === "error" ? "var(--err)" : sw.status === "cancelled" ? "var(--fg-faint)" : "var(--accent)";
                          return (
                            <button
                              className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-medium leading-[16px]"
                              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
                              title={`Swarm: ${sw.status} — open`}
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
                          className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-accent opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                          title="Run an agent swarm on this task (several departments in parallel)"
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
                          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-accent opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                          title="Delegate to the AI department"
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
                {!col.length && (
                  <div className={`rounded border border-dashed px-2 py-4 text-center text-[11.5px] ${over ? "border-accent text-accent" : "border-line text-faint"}`}>
                    {dragId ? "Drop here" : status === "backlog" ? "Generate a plan or add a task" : "Drag tasks here"}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <input
                    id={`add-${status}`}
                    className="input h-7 !border-transparent bg-transparent hover:!border-line focus:!border-accent"
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
                    <button className="icon-btn" aria-label="Add task" onClick={() => add(status)}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

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
            await api(`/api/tasks/${editing.id}`, { method: "DELETE" });
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
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[560px] max-w-[94vw] space-y-3 rounded-lg border border-line bg-elev p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="section-title">Task</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <input className="input text-[14px]" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
        <textarea className="input" rows={8} placeholder="Details, acceptance criteria…" value={t.detail} onChange={(e) => setT({ ...t, detail: e.target.value })} />
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
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button className="btn" onClick={onDelete}>
            <Trash2 size={13} /> Delete
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onDelegate}>
            <Bot size={13} /> Delegate to AI
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ title: t.title, detail: t.detail, department: t.department, status: t.status, priority: t.priority })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

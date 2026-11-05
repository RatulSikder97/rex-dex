"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CircleCheckBig,
  Download,
  Eye,
  GitMerge,
  GitPullRequestDraft,
  LogIn,
  Network,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Send,
  ServerCog,
  Stethoscope,
  SquareKanban,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { Run } from "@/lib/types";
import { recheckAgents, showActivity } from "@/components/workbench/actions";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { useOpsProblems } from "@/components/ops/useOpsProblems";
import { asSection } from "@/components/ops/shared";
import { briefTitle, useMissionData } from "./data";
import { focusConversation, openInCodeMode, openPage, showWorkspace } from "./nav";
import { openSwarm, stepAction, swarmTitle, useSwarms } from "@/components/swarm/api";
import { DeptAvatar, PanelEmpty } from "./ui";

type Severity = "error" | "warn" | "info";

interface IssueAction {
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  run: () => void | Promise<void>;
}

export interface Issue {
  id: string;
  severity: Severity;
  group: "Runs" | "Swarms" | "Agents" | "Tasks" | "Extensions" | "Repository" | "Ops" | "Logs";
  icon: LucideIcon;
  /** Department icon instead of `icon`. */
  dept?: string;
  title: string;
  detail?: string;
  at?: number;
  actions: IssueAction[];
}

// ---- dismissed issues (per browser), shared by the badge and the tab
const KEY = "rex-mission-dismissed";
const listeners = new Set<() => void>();
let dismissedCache: Set<string> | null = null;
function readDismissed(): Set<string> {
  if (dismissedCache) return dismissedCache;
  try {
    dismissedCache = new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    dismissedCache = new Set();
  }
  return dismissedCache;
}
function dismiss(id: string) {
  const next = new Set(readDismissed());
  next.add(id);
  dismissedCache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next].slice(-500)));
  } catch {
    /* storage blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}
const EMPTY_SET = new Set<string>();
function useDismissed(): Set<string> {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    readDismissed,
    () => EMPTY_SET,
  );
}

const RECENT_MS = 3 * 86400_000;

async function retryRun(r: Run) {
  const s = useWorkbench.getState();
  try {
    await api("/api/runs", { method: "POST", json: { department: r.department, provider: r.provider, brief: r.brief, projectId: r.project_id, taskId: r.task_id, threadId: r.thread_id } });
    s.log("ok", "runs", "Retry started");
    s.bump();
    dismiss(`run:${r.id}`);
    if (r.thread_id) {
      focusConversation();
      s.openConversation({ department: r.department, threadId: r.thread_id });
    }
  } catch (e) {
    s.log("error", "runs", e instanceof Error ? e.message : String(e));
  }
}

/** Every actionable problem for the active project, newest/most severe first, minus dismissed ones. */
export function useIssues(): Issue[] {
  const { runs, tasks, plugins, git } = useMissionData();
  const project = useActiveProject();
  const agents = useAgents();
  const { getDepartment } = useDepartments();
  const logs = useWorkbench((s) => s.logs);
  const dismissed = useDismissed();
  const providers = agents.agents;
  const opsProblems = useOpsProblems(project?.id ?? null);
  const { swarms } = useSwarms(project?.id);

  return useMemo(() => {
    const out: Issue[] = [];
    const now = Date.now();
    const s = () => useWorkbench.getState();

    // Failed / cancelled runs (latest per thread only, so a retried conversation doesn't keep nagging).
    const latestByThread = new Map<string, Run>();
    for (const r of runs) if (r.thread_id && !latestByThread.has(r.thread_id)) latestByThread.set(r.thread_id, r);
    for (const r of runs) {
      if (r.status !== "error" && r.status !== "cancelled") continue;
      if (now - r.created_at > RECENT_MS) continue;
      if (r.thread_id && latestByThread.get(r.thread_id)?.id !== r.id) continue;
      if (r.thread_id?.startsWith("swarm:")) continue; // reported once per swarm below
      const d = getDepartment(r.department);
      const err = r.error || (r.status === "cancelled" ? "Cancelled" : "Failed");
      out.push({
        id: `run:${r.id}`,
        severity: r.status === "error" ? "error" : "warn",
        group: "Runs",
        icon: AlertOctagon,
        dept: r.department,
        title: `${d.name} run ${r.status === "error" ? "failed" : "was cancelled"}: ${briefTitle(r.brief, 70)}`,
        detail: err,
        at: r.finished_at ?? r.created_at,
        actions: [
          { label: "Retry", icon: RotateCcw, primary: true, run: () => retryRun(r) },
          {
            label: "Ask Engineering to fix",
            icon: Wrench,
            run: () => {
              focusConversation();
              s().delegate({
                department: "engineering",
                brief: `A ${d.name} agent run failed. Find the root cause and fix it.\n\nTask: ${briefTitle(r.brief, 300)}\nError: ${err}`,
                context: `Failed run ${r.id} (${agents.label(r.provider)}, ${new Date(r.created_at).toISOString()})\n\nError:\n${err}\n\nOutput tail:\n${(r.output || "").slice(-4000)}`,
              });
            },
          },
        ],
      });
    }

    // Swarms that stopped on a failed step (or failed to plan).
    for (const sw of swarms ?? []) {
      if (sw.status !== "error") continue;
      const failed = sw.steps.filter((st) => st.status === "error");
      const first = failed[0];
      const open = { label: "Open swarm", icon: Network, primary: true, run: () => openPage({ kind: "swarm", id: sw.id }, swarmTitle(sw.goal)) };
      out.push({
        id: `swarm:${sw.id}:${failed.map((f) => `${f.id}:${f.finished_at ?? 0}`).join(",") || "plan"}`,
        severity: "error",
        group: "Swarms",
        icon: Network,
        dept: first?.department,
        title: first ? `Swarm step failed: ${first.title}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}` : `Swarm planning failed: ${briefTitle(sw.goal, 70)}`,
        detail: first?.error ?? sw.error ?? undefined,
        at: sw.finished_at ?? first?.finished_at ?? sw.created_at,
        actions: first
          ? [
              open,
              {
                label: "Retry step",
                icon: RotateCcw,
                run: async () => {
                  if (await stepAction(sw.id, first.id, "retry")) {
                    s().bump();
                    openSwarm(sw);
                  }
                },
              },
            ]
          : [open],
      });
    }

    // Agents that can't run.
    for (const a of providers) {
      if (a.available) continue;
      const actions: IssueAction[] = [];
      if (a.install) actions.push({ label: "Install", icon: Download, primary: true, run: () => s().launchTerminal({ id: a.id, action: "install" }) });
      if (a.login) actions.push({ label: "Sign in", icon: LogIn, run: () => s().launchTerminal({ id: a.id, action: "login" }) });
      actions.push({ label: "Recheck", icon: RefreshCw, run: () => recheckAgents() });
      out.push({ id: `agent:${a.id}`, severity: a.builtin ? "error" : "warn", group: "Agents", icon: AlertTriangle, title: `${a.label} isn't installed`, detail: a.detail, actions });
    }

    // Tasks that need attention.
    for (const t of tasks) {
      if (t.status === "done") continue;
      const d = getDepartment(t.department);
      const delegate: IssueAction = {
        label: "Delegate",
        icon: Send,
        primary: t.status !== "review",
        run: () => {
          focusConversation();
          s().delegate({ department: t.department, brief: t.detail ? `${t.title}\n\n${t.detail}` : t.title, taskId: t.id });
        },
      };
      if (t.status === "review") {
        out.push({
          id: `task:${t.id}:review`,
          severity: "warn",
          group: "Tasks",
          icon: Eye,
          dept: t.department,
          title: `Review: ${t.title}`,
          detail: `${d.name} finished this task and it's waiting for your review.`,
          at: t.updated_at,
          actions: [
            {
              label: "Mark done",
              icon: Check,
              primary: true,
              run: async () => {
                await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { status: "done" } }).catch((e) => s().log("error", "tasks", String(e)));
                s().bump();
              },
            },
            { label: "Send back", icon: Send, run: delegate.run },
          ],
        });
      } else if (t.priority === "urgent" || t.priority === "high") {
        out.push({
          id: `task:${t.id}:${t.priority}`,
          severity: t.priority === "urgent" ? "error" : "warn",
          group: "Tasks",
          icon: AlertTriangle,
          dept: t.department,
          title: `${t.priority === "urgent" ? "Urgent" : "High priority"}: ${t.title}`,
          detail: `${d.name} · ${t.status === "doing" ? "in progress" : t.status === "todo" ? "to do" : "backlog"}`,
          at: t.updated_at,
          actions: [delegate, ...(project ? [{ label: "Board", icon: SquareKanban, run: () => openPage({ kind: "board", projectId: project.id }, `${project.name} · Board`) }] : [])],
        });
      }
    }

    // Extension errors.
    for (const p of plugins) {
      if (!p.error) continue;
      out.push({
        id: `plugin:${p.manifest.id}:${p.error.slice(0, 60)}`,
        severity: "error",
        group: "Extensions",
        icon: Puzzle,
        title: `Extension "${p.manifest.name}" failed`,
        detail: p.error,
        actions: [{ label: "Open extension", icon: Puzzle, primary: true, run: () => openPage({ kind: "extension", id: p.manifest.id }, p.manifest.name) }],
      });
    }

    // Repository.
    if (git?.repo) {
      if (git.conflicts.length)
        out.push({
          id: `git:conflicts:${git.conflicts.length}`,
          severity: "error",
          group: "Repository",
          icon: GitMerge,
          title: `${git.conflicts.length} merge conflict${git.conflicts.length === 1 ? "" : "s"}`,
          detail: git.conflicts.slice(0, 5).map((c) => c.path).join(", "),
          actions: [
            { label: "Resolve in Code mode", icon: GitMerge, primary: true, run: () => (openInCodeMode(), showActivity("scm")) },
            {
              label: "Ask Engineering",
              icon: Wrench,
              run: () => {
                focusConversation();
                s().delegate({ department: "engineering", brief: `Resolve the merge conflicts in: ${git.conflicts.map((c) => c.path).join(", ")}` });
              },
            },
          ],
        });
      const dirty = git.staged.length + git.unstaged.length;
      if (dirty)
        out.push({
          id: `git:dirty:${dirty}`,
          severity: "info",
          group: "Repository",
          icon: GitPullRequestDraft,
          title: `${dirty} uncommitted change${dirty === 1 ? "" : "s"} on ${git.branch ?? "HEAD"}`,
          detail: "Review what the agents changed, then commit.",
          actions: [
            { label: "Review", icon: Eye, primary: true, run: () => showWorkspace("output") },
            { label: "Source control", icon: GitMerge, run: () => (openInCodeMode(), showActivity("scm")) },
          ],
        });
    }

    // Ops: monitors down, TLS expiring, unhealthy servers, failing pods (computed server-side).
    for (const p of opsProblems) {
      const section = asSection(p.section);
      out.push({
        id: `ops:${p.section}:${p.title}`,
        severity: p.severity,
        group: "Ops",
        icon: ServerCog,
        title: p.title,
        detail: p.detail,
        actions: [
          { label: "Open in Ops", icon: ServerCog, primary: true, run: () => openPage({ kind: "ops", section }, "Ops") },
          {
            label: "Ask QA & DevOps",
            icon: Stethoscope,
            run: () => {
              focusConversation();
              s().delegate({ department: "qa", brief: `Ops problem${project ? ` on ${project.name}` : ""}: ${p.title}. Find the root cause and give exact fix commands.`, context: `${p.severity.toUpperCase()}: ${p.title}\n${p.detail}\n(section: ${p.section})` });
            },
          },
        ],
      });
    }

    // Errors logged this session.
    for (const l of logs.filter((x) => x.level === "error").slice(-8)) {
      out.push({ id: `log:${l.ts}:${l.source}`, severity: "info", group: "Logs", icon: ScrollText, title: l.text.slice(0, 160), detail: l.source, at: l.ts, actions: [] });
    }

    const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
    return out.filter((i) => !dismissed.has(i.id)).sort((a, b) => rank[a.severity] - rank[b.severity] || (b.at ?? 0) - (a.at ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agents/getDepartment are recreated per render; their inputs are listed
  }, [runs, tasks, plugins, git, logs, dismissed, providers, project, opsProblems, swarms]);
}

const SEV: Record<Severity, { color: string; label: string; group: string }> = {
  error: { color: "var(--err)", label: "Error", group: "Needs action" },
  warn: { color: "var(--warn)", label: "Warning", group: "Worth a look" },
  info: { color: "var(--accent)", label: "Info", group: "Info" },
};

/** Issues: failed runs, missing agents, tasks needing attention, extension/repo problems — grouped by severity, each with a fix. */
export default function IssuesTab() {
  const issues = useIssues();
  const [busy, setBusy] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const { getDepartment } = useDepartments();

  if (!issues.length) return <PanelEmpty icon={CircleCheckBig} title="All clear" hint="Failed runs, missing agents, reviews, urgent tasks, repo and ops problems show up here with a one-click fix." />;

  const groups = (["error", "warn", "info"] as Severity[]).map((sev) => ({ sev, list: issues.filter((i) => i.severity === sev) })).filter((g) => g.list.length);

  return (
    <div className="space-y-6 px-4 pb-6 pt-4">
      <div className="rx-card rx-in flex items-center gap-1 p-1">
        {(["error", "warn", "info"] as Severity[]).map((sev) => {
          const n = issues.filter((i) => i.severity === sev).length;
          return (
            <a
              key={sev}
              href={`#issues-${sev}`}
              onClick={(e) => {
                e.preventDefault();
                if (sev === "info") setShowInfo(true);
                requestAnimationFrame(() => document.getElementById(`issues-${sev}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
              className={`rx-press flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-hover ${n ? "" : "pointer-events-none opacity-50"}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV[sev].color }} aria-hidden />
              <span className="text-[16px] font-semibold leading-none tabular-nums" style={{ color: n ? SEV[sev].color : "var(--fg-faint)" }}>
                {n}
              </span>
              <span className="truncate text-[11px] text-muted">{SEV[sev].group}</span>
            </a>
          );
        })}
      </div>
      {groups.map(({ sev, list }) => {
        const collapsed = sev === "info" && !showInfo && groups.length > 1;
        return (
          <section key={sev} id={`issues-${sev}`} aria-label={SEV[sev].group} className="scroll-mt-3">
            <header className="mb-2 flex h-6 items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEV[sev].color }} aria-hidden />
              <h3 className="rx-label">{SEV[sev].group}</h3>
              <span className="text-[10.5px] font-semibold tabular-nums text-faint">{list.length}</span>
              <span className="flex-1" />
              {sev === "info" && groups.length > 1 && (
                <button className="rx-press flex h-6 items-center rounded-md px-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg" onClick={() => setShowInfo((v) => !v)} aria-expanded={!collapsed}>
                  {collapsed ? "Show" : "Hide"}
                </button>
              )}
            </header>
            {!collapsed && (
              <ul className="space-y-2">
                {list.map((i, idx) => {
                  const sevm = SEV[i.severity];
                  const d = i.dept ? getDepartment(i.dept) : null;
                  return (
                    <li key={i.id} className="rx-card rx-in group relative overflow-hidden py-3 pl-4 pr-3" style={{ ["--i" as string]: Math.min(idx, 8) }}>
                      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: sevm.color }} aria-label={sevm.label} />
                      <div className="flex items-start gap-3">
                        {d ? (
                          <DeptAvatar dept={d} size={26} />
                        ) : (
                          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[30%]" style={{ color: sevm.color, background: `color-mix(in srgb, ${sevm.color} 14%, transparent)` }}>
                            <i.icon size={13} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{i.title}</span>
                            {i.at && <span className="shrink-0 text-[11px] text-faint">{timeAgo(i.at)}</span>}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-faint">{i.group}</div>
                          {i.detail && <p className={`mt-1.5 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed text-muted ${i.group === "Runs" || i.group === "Swarms" || i.group === "Extensions" ? "rounded-md bg-editor px-2 py-1.5 font-mono text-[11px]" : "text-[12px]"}`}>{i.detail}</p>}
                          {!!i.actions.length && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {i.actions.map((a) => (
                                <button
                                  key={a.label}
                                  disabled={busy === `${i.id}:${a.label}`}
                                  className={`rx-press h-7 rounded-lg px-2.5 text-[11.5px] ${a.primary ? "rx-primary" : "inline-flex items-center gap-1.5 border border-line bg-panel text-fg hover:bg-hover"}`}
                                  onClick={async () => {
                                    setBusy(`${i.id}:${a.label}`);
                                    try {
                                      await a.run();
                                    } finally {
                                      setBusy(null);
                                    }
                                  }}
                                >
                                  <a.icon size={12} /> {a.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button className="icon-btn shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(i.id)}>
                          <X size={13} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

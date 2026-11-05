"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Cable,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FilePen,
  History,
  ListChecks,
  LogIn,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { api, applyChunk, extractSvg, streamRun, svgDataUrl, timeAgo, uid } from "@/lib/client";
import { desktop } from "@/lib/desktop";
import type { ConnectionInfo, ProviderId, Run, RunStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { useSetting } from "@/store/settings";
import AgentLive from "@/components/mission/AgentLive";
import { useMissionData } from "@/components/mission/data";
import { DeptAvatar } from "@/components/mission/ui";
import { Pill } from "@/components/ui/kit";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";

interface Turn {
  runId: string;
  brief: string;
  output: string;
  status: RunStatus;
  error?: string | null;
  provider: ProviderId;
  startedAt: number;
  finishedAt: number | null;
}

interface ThreadSummary {
  thread_id: string;
  title: string;
  turns: number;
  updated_at: number;
  running: number;
}

const threadKey = (projectId: string | null, dept: string) => `rex-thread:${projectId ?? "none"}:${dept}`;

function readThread(projectId: string | null, dept: string): string {
  const k = threadKey(projectId, dept);
  try {
    const v = localStorage.getItem(k);
    if (v) return v;
    const id = uid();
    localStorage.setItem(k, id);
    return id;
  } catch {
    return uid();
  }
}

function writeThread(projectId: string | null, dept: string, id: string) {
  try {
    localStorage.setItem(threadKey(projectId, dept), id);
  } catch {
    /* storage unavailable */
  }
}

const toTurn = (r: Run): Turn => ({
  runId: r.id,
  brief: r.brief,
  output: r.output,
  status: r.status,
  error: r.error,
  provider: r.provider,
  startedAt: r.created_at,
  finishedAt: r.finished_at,
});

/** Closes a popover on outside click / Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function duration(t: Turn, now: number): string {
  const ms = (t.finishedAt ?? now) - t.startedAt;
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
}

interface SyncState {
  transcript: TranscriptTurn[] | null;
  terminalAlive: boolean;
  agent: string | null;
}

const NO_SYNC: SyncState = { transcript: null, terminalAlive: false, agent: null };
const isSessionItem = (runId: string) => runId.startsWith("session:");

/**
 * Merges the agent session transcript (source of truth, includes turns typed in
 * the terminal) with REX runs (live streaming, errors, older pre-session turns).
 */
function mergeTurns(runs: Turn[], transcript: TranscriptTurn[] | null, agent: string, pendingTerminal: string | null): Turn[] {
  let out: Turn[] = runs;
  if (transcript?.length) {
    const fromSession: Turn[] = [];
    for (let i = 0; i < transcript.length; ) {
      const u = transcript[i].role === "user" ? transcript[i] : null;
      const a = u ? (transcript[i + 1]?.role === "assistant" ? transcript[i + 1] : null) : transcript[i];
      fromSession.push({ runId: `session:${i}`, brief: u?.text ?? "", output: a?.text ?? "", status: "done", provider: agent, startedAt: (u ?? a)!.at, finishedAt: a?.at ?? null, error: null });
      i += u && a ? 2 : 1;
    }
    const used = new Set<number>();
    const extra: Turn[] = [];
    for (const r of runs) {
      const idx = fromSession.findIndex((t, k) => !used.has(k) && t.brief.trim() === r.brief.trim());
      if (idx < 0) {
        extra.push(r);
        continue;
      }
      used.add(idx);
      const t = fromSession[idx];
      fromSession[idx] = { ...t, runId: r.runId, provider: r.provider, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, error: r.error, output: r.status === "running" || !t.output ? r.output : t.output };
    }
    out = [...fromSession, ...extra].sort((x, y) => x.startedAt - y.startedAt);
  }
  if (pendingTerminal && !out.some((t) => t.brief.trim() === pendingTerminal.trim())) {
    out = [...out, { runId: "pending", brief: pendingTerminal, output: "", status: "running", provider: agent, startedAt: Date.now(), finishedAt: null }];
  }
  return out;
}

export default function AgentPanel({ variant = "panel" }: { variant?: "panel" | "main" } = {}) {
  const { departments, getDepartment } = useDepartments();
  const project = useActiveProject();
  const agents = useAgents();
  const { agentDraft, delegate, log, bump, openTab, tabs, activeTabId, launchTerminal, setActivity } = useWorkbench();
  // Remount (e.g. Mission ⇄ Code mode) keeps the current conversation.
  const [deptId, setDeptId] = useState(() => {
    const { agentThread, projectId } = useWorkbench.getState();
    if (agentThread.threadId) writeThread(projectId, agentThread.department, agentThread.threadId);
    return agentThread.department || "ceo";
  });
  const dept = getDepartment(deptId);
  // Per-conversation agent/model choice; "" = the department's configured agent.
  const [agentOverride, setAgentOverride] = useState<Record<string, ProviderId>>({});
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  const [allowEdits, setAllowEdits] = useState(false);
  const [attachTab, setAttachTab] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [input, setInput] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pendingContext, setPendingContext] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [sync, setSync] = useState<SyncState>(NO_SYNC);
  const [pendingTerminal, setPendingTerminal] = useState<string | null>(null);
  const defaultMode = useSetting<string>("agent.defaultMode") === "terminal" ? "terminal" : "chat";
  const sendOnEnter = useSetting<string>("agent.sendKey") === "enter";
  const showTools = useSetting<boolean>("agent.showToolCalls") !== false;
  const [mode, setMode] = useState<"chat" | "terminal">(defaultMode);
  useEffect(() => setMode(defaultMode), [defaultMode]);
  const setAgentThread = useWorkbench((s) => s.setAgentThread);
  const conversationRequest = useWorkbench((s) => s.conversationRequest);
  // Mission home "Continue" list (empty outside Mission mode, where the provider is not mounted).
  const { threads: missionThreads } = useMissionData();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const closers = useRef<Map<string, () => void>>(new Map());
  const deptMenu = usePopover();
  const historyMenu = usePopover();

  const agentId: ProviderId = agentOverride[deptId] || agents.forDepartment(deptId);
  const agent = agents.find(agentId);
  // Until the first /api/agents answer arrives, availability is unknown — don't flash "not installed".
  const agentsLoaded = agents.agents.length > 0;
  const { loadProviders } = useWorkbench();
  const model = modelOverride[agentId] ?? agents.model(agentId);
  const canEdit = !!agent?.canEdit && dept.usesRepo && !!project?.repo_path;

  const deptName = useRef(dept.name);
  deptName.current = dept.name;
  const attach = useCallback(
    (runId: string) => {
      if (closers.current.has(runId)) return;
      const close = streamRun(runId, (ev) => {
        setTurns((ts) =>
          ts.map((t) => {
            if (t.runId !== runId) return t;
            if (ev.type === "chunk") return { ...t, output: applyChunk(t.output, ev) };
            const finishedAt = ev.status === "running" ? null : (t.finishedAt ?? Date.now());
            if (ev.type === "snapshot") return { ...t, output: ev.output, status: ev.status, error: ev.error, finishedAt };
            return { ...t, status: ev.status, error: ev.error, finishedAt };
          }),
        );
        if ((ev.type === "status" || ev.type === "snapshot") && ev.status !== "running") {
          // Desktop app: OS notification when a run we watched finishes while REX is in the background.
          if (closers.current.has(runId) && (ev.status === "done" || ev.status === "error")) {
            desktop()?.notify(ev.status === "done" ? `${deptName.current} finished` : `${deptName.current} run failed`, ev.status === "done" ? "Your agent run is complete." : (ev.error ?? "The agent run stopped with an error."));
          }
          closers.current.delete(runId);
          bump();
        }
      });
      closers.current.set(runId, close);
    },
    [bump],
  );

  const loadThread = useCallback(
    (id: string) => {
      setThreadId(id);
      api<Run[]>(`/api/runs?threadId=${id}`)
        .then((runs) => {
          setTurns(runs.map(toTurn));
          runs.filter((r) => r.status === "running").forEach((r) => attach(r.id));
        })
        .catch(() => setTurns([]));
    },
    [attach],
  );

  // Panel ⇄ terminal sync: the agent session's own transcript + whether its terminal is open.
  const syncNow = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await api<{ session: { agent: string } | null; terminalAlive: boolean; transcript: TranscriptTurn[] | null }>(`/api/threads/${threadId}`);
      setSync({ transcript: r.transcript, terminalAlive: r.terminalAlive, agent: r.session?.agent ?? null });
    } catch {
      /* transient */
    }
  }, [threadId]);

  useEffect(() => {
    setSync(NO_SYNC);
    setPendingTerminal(null);
    void syncNow();
  }, [syncNow]);

  useEffect(() => {
    const t = setInterval(() => void syncNow(), sync.terminalAlive || pendingTerminal ? 2000 : 6000);
    return () => clearInterval(t);
  }, [syncNow, sync.terminalAlive, pendingTerminal]);

  // Other views (Live tab, Mission rail) follow the current conversation.
  useEffect(() => {
    setAgentThread({ department: deptId, threadId });
  }, [deptId, threadId, setAgentThread]);

  // Switch conversation on request (Mission rail, palette).
  useEffect(() => {
    if (!conversationRequest) return;
    const id = conversationRequest.threadId ?? uid();
    writeThread(project?.id ?? null, conversationRequest.department, id);
    if (conversationRequest.department === deptId) loadThread(id);
    else setDeptId(conversationRequest.department);
    useWorkbench.setState({ conversationRequest: null });
    requestAnimationFrame(() => textarea.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new requests
  }, [conversationRequest]);

  const loadThreads = useCallback(() => {
    const qs = new URLSearchParams({ department: deptId, ...(project ? { projectId: project.id } : {}) });
    api<ThreadSummary[]>(`/api/threads?${qs}`).then(setThreads).catch(() => setThreads([]));
  }, [deptId, project]);

  useEffect(() => {
    if (agentsLoaded) return;
    const t = setTimeout(() => void loadProviders().catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [agentsLoaded, loadProviders]);

  // The current thread for this project + department.
  useEffect(() => {
    loadThread(readThread(project?.id ?? null, deptId));
  }, [project?.id, deptId, loadThread]);

  useEffect(() => {
    const map = closers.current;
    return () => map.forEach((c) => c());
  }, []);

  // Delegation from elsewhere (board task, SEO audit, palette, …)
  useEffect(() => {
    if (!agentDraft) return;
    setDeptId(agentDraft.department);
    setInput(agentDraft.brief);
    setTaskId(agentDraft.taskId ?? null);
    setPendingContext(agentDraft.context);
    delegate(null);
    requestAnimationFrame(() => textarea.current?.focus());
  }, [agentDraft, delegate]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  const running = turns.some((t) => t.status === "running");
  // A finished headless turn is now in the session transcript.
  useEffect(() => {
    if (!running) void syncNow();
  }, [running, syncNow]);

  const items = useMemo(() => mergeTurns(turns, sync.transcript, sync.agent ?? agentId, pendingTerminal), [turns, sync, agentId, pendingTerminal]);
  // The message typed into the terminal has been picked up by the session.
  useEffect(() => {
    if (pendingTerminal && sync.transcript?.some((t) => t.role === "user" && t.text.trim() === pendingTerminal.trim())) setPendingTerminal(null);
  }, [pendingTerminal, sync.transcript]);
  const busy = running || !!pendingTerminal;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Auto-grow the composer up to ~12 lines.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const attachable = activeTab?.spec.kind === "file" || activeTab?.spec.kind === "deliverable";

  const tabContext = async (): Promise<string | undefined> => {
    if (!attachTab || !activeTab) return undefined;
    const s = activeTab.spec;
    if (s.kind === "file") {
      const f = await api<{ content: string; binary: boolean }>(`/api/files?mode=read&projectId=${s.projectId}&path=${encodeURIComponent(s.path)}`);
      return f.binary ? undefined : `File: ${s.path}\n\`\`\`\n${f.content}\n\`\`\``;
    }
    if (s.kind === "deliverable") {
      const d = await api<{ title: string; content: string }>(`/api/deliverables/${s.id}`);
      return `Document: ${d.title}\n\n${d.content}`;
    }
    return undefined;
  };

  const send = async () => {
    const brief = input.trim();
    if (!brief || !threadId) return;
    if (!agent?.available) {
      log("error", dept.name, `${agents.label(agentId)} isn't installed. Install it from Settings → Agents, or pick another agent.`);
      return;
    }
    try {
      const ctx = [pendingContext, await tabContext()].filter(Boolean).join("\n\n") || undefined;
      if (sync.terminalAlive) {
        // The conversation is open in the terminal: type into that live session.
        await api(`/api/threads/${threadId}/send`, { method: "POST", json: { text: ctx ? `<rex-context>\n${ctx}\n</rex-context>\n\n${brief}` : brief } });
        setPendingTerminal(brief);
        setInput("");
        setTaskId(null);
        setPendingContext(undefined);
        return;
      }
      const run = await api<Run>("/api/runs", {
        method: "POST",
        json: {
          department: deptId,
          // Only an explicit pick pins the agent; otherwise the server resolves it and falls back if its sign-in fails.
          provider: agentOverride[deptId] || null,
          model: model || null,
          brief,
          projectId: project?.id ?? null,
          taskId,
          threadId,
          allowEdits: canEdit && allowEdits,
          context: ctx,
        },
      });
      setTurns((ts) => [...ts, toTurn(run)]);
      setInput("");
      setTaskId(null);
      setPendingContext(undefined);
      attach(run.id);
      log("info", dept.name, `Started on ${agents.label(run.provider)}: ${brief.slice(0, 80)}`);
    } catch (e) {
      log("error", dept.name, e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = (runId: string) => api(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});

  const newThread = () => {
    const id = uid();
    writeThread(project?.id ?? null, deptId, id);
    setThreadId(id);
    setTurns([]);
    textarea.current?.focus();
  };

  // Menu bar / palette: Agents → New Conversation.
  const newThreadRef = useRef(newThread);
  newThreadRef.current = newThread;
  useEffect(() => {
    const onNew = (e: Event) => {
      e.preventDefault();
      newThreadRef.current();
    };
    window.addEventListener("rex:agent-new-conversation", onNew);
    return () => window.removeEventListener("rex:agent-new-conversation", onNew);
  }, []);

  const openThread = (id: string) => {
    writeThread(project?.id ?? null, deptId, id);
    loadThread(id);
    historyMenu.setOpen(false);
  };

  const removeThread = async (id: string) => {
    await api(`/api/threads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === threadId) newThread();
    loadThreads();
    bump();
  };

  const openInTerminal = () => {
    if (!agent?.interactive) return log("error", dept.name, `${agents.label(agentId)} has no interactive terminal mode`);
    launchTerminal({ id: agentId, action: "interactive", department: deptId, model: model || undefined });
    log("info", dept.name, `Opened ${agents.label(agentId)} in the terminal as ${dept.name}`);
  };

  const save = async (t: Turn) => {
    const svg = dept.outputKind === "svg" ? extractSvg(t.output) : null;
    const d = await api<{ id: string; title: string }>("/api/deliverables", {
      method: "POST",
      json: {
        project_id: project?.id ?? null,
        run_id: isSessionItem(t.runId) || t.runId === "pending" ? null : t.runId,
        department: deptId,
        kind: svg ? "svg" : "markdown",
        title: t.brief.replace(/\s+/g, " ").slice(0, 80),
        content: svg ?? t.output,
      },
    });
    bump();
    openTab({ kind: "deliverable", id: d.id }, d.title);
    log("ok", dept.name, `Saved deliverable "${d.title}"`);
  };

  const toTasks = async (t: Turn) => {
    if (!project) return log("error", "plan", "Select a project to add tasks");
    log("info", "plan", "Extracting tasks from agent output…");
    try {
      const created = await api<unknown[]>("/api/plan", {
        method: "POST",
        json: { projectId: project.id, goal: `Convert this department output into board tasks:\n\n${t.output}` },
      });
      log("ok", "plan", `Added ${created.length} tasks to ${project.name}`);
      bump();
      openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`);
    } catch (e) {
      log("error", "plan", e instanceof Error ? e.message : String(e));
    }
  };

  const builtinDepts = departments.filter((d) => !d.pluginId);
  const pluginDepts = departments.filter((d) => d.pluginId);
  const runningTurn = turns.find((t) => t.status === "running");

  const agentItems: PickerItem[] = [
    { id: "", label: `${agents.label(agents.forDepartment(deptId))}`, sub: "Department default", icon: agents.find(agents.forDepartment(deptId))?.icon, dot: "ok" },
    ...agents.agents.map((a) => ({
      id: a.id,
      label: a.label,
      sub: a.available ? (a.detail.length > 42 ? a.detail.slice(0, 42) + "…" : a.detail) : "Not installed",
      icon: a.icon,
      dot: (a.available ? "ok" : "err") as "ok" | "err",
      disabled: !a.available,
    })),
  ];
  const modelItems: PickerItem[] = [{ id: "", label: "Default model", sub: "Whatever the CLI is configured to use" }, ...(agent?.models ?? []).map((m) => ({ id: m, label: m }))];

  const composerFooter = (
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-faint">
          <span className="min-w-0 truncate">
            {agentsLoaded && !agent?.available ? (
              <span className="text-warn">{agents.label(agentId)} isn&apos;t installed</span>
            ) : sync.terminalAlive ? (
              `Typing into ${agents.label(sync.agent ?? agentId)}'s live terminal session`
            ) : (
              `Runs locally via ${agents.label(agentId)}`
            )}
          </span>
          <span className="shrink-0">
            <span className="kbd">{sendOnEnter ? "↵" : "⌘↵"}</span> send
          </span>
        </div>
  );

  const composerBox = (large: boolean) => (
        <div className="rx-composer">
          {(taskId || pendingContext || (attachTab && attachable)) && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
              {(taskId || pendingContext) && (
                <Chip
                  label={taskId ? "Board task" : "Context"}
                  onRemove={() => {
                    setTaskId(null);
                    setPendingContext(undefined);
                  }}
                />
              )}
              {attachTab && attachable && <Chip label={activeTab?.title ?? "tab"} onRemove={() => setAttachTab(false)} />}
            </div>
          )}
          <textarea
            ref={textarea}
            style={{ outline: "none" }}
            className={`block max-h-60 w-full resize-none bg-transparent px-3.5 pb-1 leading-relaxed outline-none placeholder:text-faint ${large ? "min-h-[72px] pt-3 text-[13px]" : "min-h-[52px] pt-2.5 text-[13px]"}`}
            rows={2}
            placeholder={large ? `Ask ${dept.name} to plan, build, write or ship something…` : `Message ${dept.name}…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && (sendOnEnter ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            suppressHydrationWarning
          />
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
            <Picker
              items={agentItems}
              value={agentOverride[deptId] ?? ""}
              onChange={(v) => setAgentOverride((o) => ({ ...o, [deptId]: v }))}
              buttonLabel={agents.label(agentId)}
              buttonIcon={agent?.icon}
              title="Agent"
              footer={
                <button
                  className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-hover hover:text-fg"
                  onClick={() => setActivity("extensions")}
                >
                  <Plus size={13} /> Add agents from Extensions
                </button>
              }
            />
            {!!agent?.models.length && <Picker items={modelItems} value={model} onChange={(v) => setModelOverride((o) => ({ ...o, [agentId]: v }))} buttonLabel={model || "Default model"} title="Model" />}
            {canEdit && (
              <Toggle on={allowEdits} onClick={() => setAllowEdits((v) => !v)} icon={<FilePen size={12} />} label="Edits" title="Let the agent edit files in the project repo" />
            )}
            {attachable && <Toggle on={attachTab} onClick={() => setAttachTab((v) => !v)} icon={<Paperclip size={12} />} label="Tab" title={`Attach "${activeTab?.title}" as context`} />}
            <div className="flex-1" />
            {runningTurn && !input.trim() ? (
              <button type="button" className="btn !h-7 !w-7 shrink-0 !p-0" onClick={() => cancel(runningTurn.runId)} title="Stop" aria-label="Stop">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary !h-7 !w-7 shrink-0 !p-0"
                onClick={() => void send()}
                disabled={!input.trim() || !agent?.available}
                title={`${busy ? "Queue message" : "Send"} (${sendOnEnter ? "↩" : "⌘↩"})`}
                aria-label={`${busy ? "Queue message" : "Send"} (${sendOnEnter ? "↩" : "⌘↩"})`}
              >
                <ArrowUp size={14} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
  );

  // ---- Mission home (main variant, empty conversation): greeting, team roster, big composer, suggestions, recent tasks.
  const home = variant === "main" && !items.length;
  const suggestions = departments
    .filter((d) => d.quickActions.length)
    .map((d) => ({ d, q: d.quickActions.find((q) => !/:\s*$/.test(q.prompt)) ?? d.quickActions[0] }))
    .slice(0, 6);
  const recent = missionThreads.filter((t) => !t.thread_id.startsWith("swarm:") && t.thread_id !== threadId).slice(0, 3);
  const pick = (id: string, prompt?: string) => {
    setDeptId(id);
    if (prompt !== undefined) setInput(prompt);
    requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }));
  };
  const rosterKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = departments.findIndex((d) => d.id === deptId);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = departments[(i + step + departments.length) % departments.length];
    setDeptId(next.id);
    requestAnimationFrame(() => document.getElementById(`roster-${next.id}`)?.focus());
  };
  const installNotice = agentsLoaded && !agent?.available && (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-[6px] border border-[color:color-mix(in_srgb,var(--warn)_40%,var(--border))] bg-[color:color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-fg">{agents.label(agentId)} isn&apos;t installed on this machine.</span>
      {agent?.login && (
        <button type="button" className="btn btn-sm" onClick={() => launchTerminal({ id: agentId, action: "login" })}>
          <LogIn size={12} /> Sign in
        </button>
      )}
      {agent?.install && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => launchTerminal({ id: agentId, action: "install" })}>
          <Download size={12} /> Install in terminal
        </button>
      )}
    </div>
  );
  const repoNotice = dept.usesRepo && !project?.repo_path && <p className="mt-2 text-[12px] text-warn">Link a repo folder in project settings so {dept.name} can work inside your codebase.</p>;
  const homeView = (
    <div className="@container mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-6 pb-8 pt-6">
      <div>
        {project && (
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-muted">
            <ProjectAvatar project={project} size={16} />
            <span className="truncate font-medium text-fg" title={project.name}>
              {project.name}
            </span>
            <Pill className="capitalize">{project.stage}</Pill>
            {!project.logo && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openLogoStudio(project.id)}>
                <Sparkles size={12} /> Generate a logo
              </button>
            )}
          </div>
        )}
        <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-fg">What should your company do today?</h1>
        <p className="mt-1 text-[12.5px] text-muted">Pick who answers, describe the outcome, and they get to work.</p>
      </div>

      {/* team roster */}
      <div className="mt-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Who answers" onKeyDown={rosterKey}>
          {departments.map((d) => {
            const on = d.id === deptId;
            return (
              <button
                key={d.id}
                id={`roster-${d.id}`}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={d.name}
                tabIndex={on ? 0 : -1}
                title={`${d.name} — ${d.role}`}
                onClick={() => pick(d.id)}
                className={`grid h-7 w-7 place-items-center rounded-[6px] transition-colors ${on ? "bg-active shadow-[inset_0_0_0_1px_var(--accent)]" : "hover:bg-hover"}`}
              >
                <DeptAvatar dept={d} size={22} />
              </button>
            );
          })}
        </div>
        <span className="min-w-0 truncate text-[12px] text-muted" title={dept.role}>
          <span className="font-medium text-fg">{dept.name}</span> · {dept.role}
        </span>
      </div>

      <div className="mt-3">
        {composerBox(true)}
        {composerFooter}
      </div>
      {installNotice}
      {repoNotice}

      {suggestions.length > 0 && (
        <section aria-labelledby="home-suggestions" className="mt-7">
          <h2 id="home-suggestions" className="section-title mb-2">
            Suggestions
          </h2>
          <div className="grid grid-cols-1 gap-1.5 @sm:grid-cols-2">
            {suggestions.map(({ d, q }) => (
              <button
                key={`${d.id}:${q.label}`}
                type="button"
                className="flex h-9 min-w-0 items-center gap-2.5 rounded-[6px] border border-line px-2.5 text-left transition-colors hover:bg-hover"
                onClick={() => pick(d.id, q.prompt)}
                title={q.prompt}
              >
                <DeptAvatar dept={d} size={20} />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {q.label}
                  <span className="text-faint"> · {d.name}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="home-continue" className="mt-6">
          <h2 id="home-continue" className="section-title mb-1">
            Continue
          </h2>
          <ul className="-mx-2">
            {recent.map((t) => {
              const d = getDepartment(t.department);
              return (
                <li key={t.thread_id}>
                  <button
                    type="button"
                    className="flex h-7 w-full min-w-0 items-center gap-2.5 rounded-[4px] px-2 text-left hover:bg-hover"
                    onClick={() => useWorkbench.getState().openConversation({ department: t.department, threadId: t.thread_id })}
                    title={t.title}
                  >
                    <DeptAvatar dept={d} size={18} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                    <span className="hidden shrink-0 text-[11px] text-faint @md:inline">
                      {d.name} · {t.turns} message{t.turns === 1 ? "" : "s"}
                    </span>
                    <span className={`w-14 shrink-0 text-right text-[11px] ${t.running ? "font-medium text-accent" : "text-faint"}`}>{t.running ? "Running" : timeAgo(t.updated_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <aside className={`flex h-full w-full flex-col ${variant === "main" ? "bg-editor" : "bg-side"}`} aria-label="Agent panel">
      {/* header */}
      <div className={`flex shrink-0 items-center gap-1 border-b border-line ${variant === "main" ? "h-9 px-2" : "h-9 px-2"}`}>
        <div className="relative min-w-0" ref={deptMenu.ref}>
          <button
            className="flex h-7 min-w-0 items-center gap-2 rounded-[4px] px-1.5 hover:bg-hover"
            onClick={() => deptMenu.setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={deptMenu.open}
            title="Switch department"
          >
            <DeptAvatar dept={dept} size={20} />
            <span className="truncate text-[13px] font-semibold">{dept.name}</span>
            <ChevronDown size={13} className="shrink-0 text-faint" />
          </button>
          {deptMenu.open && (
            <div className="popover absolute left-0 top-9 z-30 max-h-[70vh] w-80 overflow-y-auto p-1" role="listbox">
              {[
                ["Departments", builtinDepts],
                ["From extensions", pluginDepts],
              ].map(([title, list]) =>
                (list as typeof departments).length ? (
                  <div key={title as string}>
                    <div className="section-title px-2.5 pb-1 pt-2">{title as string}</div>
                    {(list as typeof departments).map((d) => (
                      <button
                        key={d.id}
                        role="option"
                        aria-selected={d.id === deptId}
                        onClick={() => {
                          setDeptId(d.id);
                          deptMenu.setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-left hover:bg-hover ${d.id === deptId ? "bg-active" : ""}`}
                      >
                        <DeptAvatar dept={d} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{d.name}</span>
                          <span className="block truncate text-[11px] text-muted">{d.role}</span>
                        </span>
                        {d.id === deptId && <Check size={13} className="shrink-0 text-accent" />}
                      </button>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
        {sync.terminalAlive && (
          <Pill tone="ok" className="ml-1 shrink-0" title="This task is open in the agent's terminal; messages are typed there">
            Live
          </Pill>
        )}
        <div className="flex-1" />
        {agent?.interactive && (
          <div className="seg mr-1 shrink-0" role="tablist" aria-label="View">
            {(["chat", "terminal"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className="capitalize"
                onClick={() => setMode(m)}
                title={m === "chat" ? "Chat view of this task" : `${agents.label(agentId)}'s own terminal UI, same session`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        <button className="icon-btn" title={`Open ${agents.label(agentId)} in the terminal as ${dept.name}`} aria-label="Open in terminal" onClick={openInTerminal} disabled={!agent?.available || !agent.interactive}>
          <SquareTerminal size={15} />
        </button>
        <div className="relative" ref={historyMenu.ref}>
          <button
            className="icon-btn"
            title="Task history"
            aria-label="Task history"
            onClick={() => {
              if (!historyMenu.open) loadThreads();
              historyMenu.setOpen((o) => !o);
            }}
          >
            <History size={15} />
          </button>
          {historyMenu.open && (
            <div className="popover absolute right-0 top-9 z-30 max-h-[60vh] w-80 overflow-y-auto p-1">
              <div className="section-title px-2.5 pb-1 pt-2">{dept.name} · history</div>
              {threads.map((t) => (
                <div
                  key={t.thread_id}
                  className={`group flex items-center gap-2 rounded-[4px] px-2.5 py-1.5 hover:bg-hover ${t.thread_id === threadId ? "bg-active" : ""}`}
                  onClick={() => openThread(t.thread_id)}
                >
                  <MessageSquare size={13} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]" title={t.title}>{t.title}</span>
                    <span className="block text-[11px] text-faint">
                      {t.turns} message{t.turns === 1 ? "" : "s"} · {timeAgo(t.updated_at)}
                      {t.running ? " · running" : ""}
                    </span>
                  </span>
                  {!t.running && (
                    <button
                      className="icon-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title="Delete task"
                      aria-label="Delete task"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeThread(t.thread_id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              {!threads.length && <div className="px-2.5 py-3 text-center text-[12px] text-muted">No tasks yet.</div>}
            </div>
          )}
        </div>
        <button className="icon-btn" title="New task" aria-label="New task" onClick={newThread}>
          <Plus size={15} />
        </button>
      </div>

      {mode === "terminal" ? (
        <div className="min-h-0 flex-1">
          <AgentLive />
        </div>
      ) : (
        <>
      {/* transcript */}
      {home ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{homeView}</div>
      ) : (
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {!items.length ? (
          <div className="@container flex min-h-full flex-col justify-center px-4 py-6">
            <div className="flex items-center gap-2.5">
              <DeptAvatar dept={dept} size={28} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold">How can {dept.name} help?</h2>
                <p className="truncate text-[12px] text-muted" title={dept.role}>
                  {dept.role}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="btn btn-ghost btn-sm -ml-2"
                onClick={() => {
                  openTab({ kind: "settings" }, "Settings");
                  setActivity("settings");
                  setTimeout(() => document.getElementById("settings-agents")?.scrollIntoView({ behavior: "smooth" }), 150);
                }}
                title={agent?.detail ? `${agent.detail} — change in Settings` : "Change the agent in Settings"}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${!agentsLoaded ? "bg-faint" : agent?.authError ? "bg-warn" : agent?.available ? "bg-ok" : "bg-err"}`} aria-hidden />
                <span className="max-w-[220px] truncate">
                  {agents.label(agentId)}
                  {model ? ` · ${model}` : ""}
                  {project ? ` · ${project.name}` : ""}
                </span>
              </button>
            </div>

            <DeptConnections department={dept.id} />
            {installNotice}
            {repoNotice}

            {dept.quickActions.length > 0 && (
              <section aria-labelledby="panel-suggestions" className="mt-5">
                <h3 id="panel-suggestions" className="section-title mb-1.5">
                  Suggestions
                </h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {dept.quickActions.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      className="flex h-8 min-w-0 items-center gap-2 rounded-[6px] border border-line px-2.5 text-left transition-colors hover:bg-hover"
                      onClick={() => {
                        setInput(q.prompt);
                        textarea.current?.focus();
                      }}
                      title={q.prompt}
                    >
                      <Sparkles size={12} className="shrink-0 text-faint" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{q.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className={`${variant === "main" ? "mx-auto w-full max-w-3xl space-y-8 px-6 py-7" : "space-y-6 px-3 py-4"}`}>
            {items.map((t) => (
              <div key={t.runId} className="rx-fade space-y-3">
                <div className="flex justify-end">
                  <div className={`max-w-[85%] rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_22%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-3.5 py-2 leading-relaxed whitespace-pre-wrap text-fg ${variant === "main" ? "text-[13px]" : "text-[12.5px]"}`}>{t.brief}</div>
                </div>
                <div className="group">
                  <div className="mb-1.5 flex items-center gap-2">
                    <DeptAvatar dept={dept} size={22} />
                    <span className="text-[13px] font-semibold">{dept.name}</span>
                    <span className="text-[11px] text-faint">
                      {agents.label(t.provider)} · {t.status === "running" ? duration(t, now) : `${duration(t, now)}${t.status === "done" ? "" : ` · ${t.status}`}`}
                    </span>
                  </div>
                  <div className="pl-[30px]">
                    {t.output ? <AgentOutput text={t.output} streaming={t.status === "running"} showTools={showTools} /> : null}
                    {t.status === "running" && !t.output && <Typing />}
                    {dept.outputKind === "svg" && t.status === "done" && extractSvg(t.output) && (
                      <img alt="Generated graphic" className="mt-2 w-full rounded-[6px] border border-line bg-white" src={svgDataUrl(extractSvg(t.output)!)} />
                    )}
                    {t.error && <div className="mt-2 rounded-[6px] border border-err/40 bg-err/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-err">{t.error}</div>}
                    {t.status !== "running" && t.output && (
                      <div className="mt-1.5 flex items-center gap-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <CopyButton text={t.output} />
                        {!isSessionItem(t.runId) && t.runId !== "pending" && (
                          <button className="icon-btn" title="Open in editor" aria-label="Open in editor" onClick={() => openTab({ kind: "run", id: t.runId }, `Run · ${dept.name}`)}>
                            <ExternalLink size={13} />
                          </button>
                        )}
                        <button className="icon-btn" title="Turn into board tasks" aria-label="Turn into board tasks" onClick={() => toTasks(t)}>
                          <ListChecks size={13} />
                        </button>
                        <button className="icon-btn" title="Save as deliverable" aria-label="Save as deliverable" onClick={() => save(t)}>
                          <Save size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* composer */}
      {!home && (
      <div className={`shrink-0 pb-3 pt-1 ${variant === "main" ? "mx-auto w-full max-w-3xl px-6" : "px-3"}`}>
        {composerBox(false)}
        {composerFooter}
      </div>
      )}
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- pieces

interface PickerItem {
  id: string;
  label: string;
  sub?: string;
  icon?: string;
  dot?: "ok" | "err";
  disabled?: boolean;
}

/** Composer pill that opens a custom menu upward (native <select> popups look out of place). */
function Picker(props: { items: PickerItem[]; value: string; onChange: (v: string) => void; buttonLabel: string; buttonIcon?: string; title: string; footer?: React.ReactNode }) {
  const pop = usePopover();
  return (
    <div className="relative min-w-0" ref={pop.ref}>
      <button
        className={`flex h-6 min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg ${pop.open ? "bg-hover text-fg" : ""}`}
        onClick={() => pop.setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        aria-label={props.title}
        title={props.title}
      >
        {props.buttonIcon && <DeptIcon name={props.buttonIcon} size={12} />}
        <span className="max-w-[8.5rem] truncate">{props.buttonLabel}</span>
        <ChevronDown size={11} className="shrink-0 opacity-70" />
      </button>
      {pop.open && (
        <div className="popover absolute bottom-8 left-0 z-30 max-h-[50vh] w-64 overflow-y-auto p-1" role="listbox" aria-label={props.title}>
          <div className="section-title px-2.5 pb-1 pt-1.5">{props.title}</div>
          {props.items.map((it) => (
            <button
              key={it.id || "__default"}
              role="option"
              aria-selected={it.id === props.value}
              disabled={it.disabled}
              onClick={() => {
                props.onChange(it.id);
                pop.setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-left hover:bg-hover disabled:opacity-45 disabled:hover:bg-transparent"
            >
              {it.icon ? <DeptIcon name={it.icon} size={14} /> : <span className="w-[14px]" />}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12.5px]">
                  {it.label}
                  {it.dot && <span className={`h-1.5 w-1.5 rounded-full ${it.dot === "ok" ? "bg-ok" : "bg-err"}`} />}
                </span>
                {it.sub && <span className="block truncate text-[11px] text-faint">{it.sub}</span>}
              </span>
              {it.id === props.value && <Check size={13} className="shrink-0 text-accent" />}
            </button>
          ))}
          {props.footer && <div className="mt-1 border-t border-line pt-1">{props.footer}</div>}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, icon, label, title }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; title: string }) {
  return (
    <button
      className={`flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[12px] ${on ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover hover:text-fg"}`}
      onClick={onClick}
      aria-pressed={on}
      title={title}
    >
      {icon} {label}
    </button>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex max-w-full items-center gap-1 rounded-md border border-line bg-elev px-1.5 py-0.5 text-[11px] text-muted">
      <Paperclip size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
      <button className="ml-0.5 shrink-0 text-faint hover:text-fg" aria-label={`Remove ${label}`} onClick={onRemove}>
        <X size={11} />
      </button>
    </span>
  );
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-faint" style={{ animation: `rex-pulse 1.1s ${i * 0.18}s infinite ease-in-out` }} />
      ))}
    </span>
  );
}

/** Tool-call lines the runners emit ("> 🔧 **Tool** `detail`", "> ✏️ edit `path`"). */
const TOOL_LINE = /^> (🔧|✏️) (.*)$/;

/** Agent output: markdown, with tool calls collapsed into compact activity chips. */
function AgentOutput({ text, streaming, showTools = true }: { text: string; streaming: boolean; showTools?: boolean }) {
  const segments: ({ kind: "md"; text: string } | { kind: "tools"; items: string[] })[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(TOOL_LINE);
    const last = segments[segments.length - 1];
    if (m) {
      const item = m[2].replace(/\*\*/g, "");
      if (last?.kind === "tools") last.items.push(item);
      else segments.push({ kind: "tools", items: [item] });
    } else if (last?.kind === "md") last.text += "\n" + line;
    else if (line.trim() || last) segments.push({ kind: "md", text: line });
  }
  return (
    <div className="space-y-2">
      {segments.map((s, i) =>
        s.kind === "tools" ? (
          !showTools ? null : <ToolGroup key={i} items={s.items} live={streaming && i === segments.length - 1} />
        ) : s.text.trim() ? (
          <Markdown key={i} text={s.text.trim()} streaming={streaming && i === segments.length - 1} />
        ) : null,
      )}
    </div>
  );
}

function ToolGroup({ items, live }: { items: string[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open || items.length <= 3 ? items : items.slice(-2);
  return (
    <div className="rounded-[6px] border border-line bg-elev/40 px-2 py-1.5">
      {items.length > 3 && (
        <button className="mb-1 flex items-center gap-1 text-[11px] text-faint hover:text-fg" onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={11} className={open ? "" : "-rotate-90"} /> {items.length} actions
        </button>
      )}
      {shown.map((it, i) => {
        const [, name = it, detail = ""] = it.match(/^(\S+)\s*`?([^`]*)`?$/) ?? [];
        return (
          <div key={i} className="flex min-w-0 items-center gap-1.5 py-0.5 text-[11.5px]">
            <Wrench size={11} className={`shrink-0 ${live && i === shown.length - 1 ? "animate-pulse text-accent" : "text-faint"}`} />
            <span className="shrink-0 font-medium text-muted">{name}</span>
            {detail && <span className="truncate font-mono text-[11px] text-faint">{detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn"
      title="Copy"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  );
}

/** The department's third-party connections (tools its agent can use), with a link to manage them. */
function DeptConnections({ department }: { department: string }) {
  const { openTab, version } = useWorkbench();
  const [list, setList] = useState<ConnectionInfo[]>([]);
  useEffect(() => {
    api<ConnectionInfo[]>("/api/connections")
      .then((l) => setList(l.filter((c) => c.departments.includes(department) && c.installed && c.status !== "disabled")))
      .catch(() => setList([]));
  }, [department, version]);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Tools this department can use">
      {list.map((c) => (
        <Pill key={c.id} tone={c.status === "connected" ? "neutral" : "warn"} title={`${c.name}: ${c.statusDetail}`}>
          <DeptIcon name={c.icon} size={11} /> {c.name}
          {c.status === "connected" ? <Check size={10} className="text-ok" aria-label="Connected" /> : null}
        </Pill>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTab({ kind: "connections" }, "Connections")}>
        <Cable size={12} /> {list.length ? "Manage tools" : "Connect tools"}
      </button>
    </div>
  );
}

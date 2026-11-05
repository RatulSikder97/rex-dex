"use client";
import { useCallback, useEffect, useState } from "react";
import { SquareTerminal, X } from "lucide-react";
import { api } from "@/lib/client";
import { DeptIcon } from "@/components/icons";
import { TerminalView, type TerminalInfo } from "@/components/workbench/TerminalPanel";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";

interface ThreadState {
  session: { agent: string; sessionId: string | null; cwd: string; terminalId: string | null } | null;
  terminalAlive: boolean;
}

/**
 * "Agent's computer": the current Agent-panel conversation running as the
 * agent's own interactive CLI. Same session as the chat — type here or in the
 * chat, both see everything.
 */
export default function AgentLive() {
  const { agentThread, log } = useWorkbench();
  const project = useActiveProject();
  const { getDepartment } = useDepartments();
  const agents = useAgents();
  const dept = getDepartment(agentThread.department);
  const agentId = agents.forDepartment(dept.id);
  const agent = agents.find(agentId);
  const [state, setState] = useState<ThreadState | null>(null);
  const [term, setTerm] = useState<TerminalInfo | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentThread.threadId) return setState(null);
    try {
      const s = await api<ThreadState>(`/api/threads/${agentThread.threadId}`);
      setState(s);
      const id = s.session?.terminalId;
      if (!id) return setTerm(null);
      setTerm((cur) => (cur?.id === id ? cur : null));
      if (term?.id !== id) {
        const list = await api<TerminalInfo[]>("/api/terminal");
        setTerm(list.find((t) => t.id === id) ?? null);
      }
    } catch {
      /* transient */
    }
  }, [agentThread.threadId, term?.id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const start = async () => {
    if (!agentThread.threadId) return;
    setStarting(true);
    try {
      const t = await api<TerminalInfo>("/api/terminal", {
        method: "POST",
        json: { projectId: project?.id ?? null, cols: 120, rows: 30, agent: { id: agentId, action: "interactive", department: dept.id, threadId: agentThread.threadId, model: agents.model(agentId) || undefined } },
      });
      setTerm(t);
      void refresh();
    } catch (e) {
      log("error", dept.name, e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!term) return;
    await api(`/api/terminal/${term.id}`, { method: "DELETE" }).catch(() => {});
    setTerm(null);
    void refresh();
  };

  if (term && state?.terminalAlive) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-[11.5px] text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
          <DeptIcon name={dept.icon} color={dept.color} size={12} />
          <span className="text-fg">{dept.name}</span>· {agents.label(state.session?.agent ?? agentId)} · live session (synced with chat)
          <div className="flex-1" />
          <button className="icon-btn" title="End terminal session" aria-label="End terminal session" onClick={() => void stop()}>
            <X size={13} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-panel">
          <TerminalView key={term.id} session={term} active onExit={() => void refresh()} />
        </div>
      </div>
    );
  }

  const interactive = !!agent?.interactive && !!agent.available;
  return (
    <div className="rx-fade flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rx-mark flex h-12 w-12 items-center justify-center rounded-2xl">
        <SquareTerminal size={22} />
      </div>
      <div className="text-[15px] font-semibold tracking-tight">Watch {dept.name} work live</div>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-muted">
        Opens this conversation in {agents.label(agentId)}&apos;s own terminal. Same session as the chat: what you type in either shows up in both.
      </p>
      <button className="rx-primary rx-press mt-1 h-8 rounded-lg px-3 text-[12px]" disabled={!agentThread.threadId || !interactive || starting} onClick={() => void start()}>
        <SquareTerminal size={13} /> {starting ? "Starting…" : `Open ${agents.label(agentId)} live`}
      </button>
      {!interactive && agent && <p className="text-[11.5px] text-warn">{agent.available ? `${agent.label} has no interactive mode` : `${agent.label} isn't installed`}</p>}
    </div>
  );
}

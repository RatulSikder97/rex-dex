"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, BellDot, Bot, CircleAlert, FolderKanban, GitBranch, TriangleAlert, X } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { useActiveProject, useAgents, useWorkbench } from "@/store/workbench";
import { TOAST_COLOR, TOAST_ICON } from "@/components/ui/toast";
import { openProjectSwitcher } from "./TitleBar";
import { showActivity } from "./actions";

interface GitInfo {
  repo: boolean;
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: unknown[];
  unstaged: unknown[];
}

function useGitBranch(projectId: string | null, hasRepo: boolean) {
  const version = useWorkbench((s) => s.version);
  const [git, setGit] = useState<GitInfo | null>(null);
  useEffect(() => {
    if (!projectId || !hasRepo) {
      setGit(null);
      return;
    }
    let stop = false;
    const load = () =>
      api<GitInfo>(`/api/git?projectId=${projectId}`)
        .then((g) => !stop && setGit(g))
        .catch(() => !stop && setGit(null));
    load();
    const t = setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [projectId, hasRepo, version]);
  return git;
}

const Item = ({ onClick, title, children, className = "" }: { onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; title: string; children: React.ReactNode; className?: string }) => (
  <button
    className={`flex h-full min-w-0 items-center gap-1 px-2 hover:bg-[color-mix(in_srgb,var(--status-fg)_14%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--status-fg)_18%,transparent)] focus-visible:outline-none ${className}`}
    onClick={onClick}
    title={title}
    aria-label={title}
  >
    {children}
  </button>
);

export default function StatusBar() {
  const project = useActiveProject();
  const { logs, setPanelTab, runningRuns, notifications, unreadNotifications, markNotificationsRead, clearNotifications, openSettings } = useWorkbench();
  const { defaultAgent, label, find, agents } = useAgents();
  const git = useGitBranch(project?.id ?? null, !!project?.repo_path);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bellOpen) return;
    const down = (e: MouseEvent) => !bellRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-bell]") && setBellOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setBellOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [bellOpen]);

  const errors = logs.filter((l) => l.level === "error").length;
  const agentId = defaultAgent();
  const agent = find(agentId);
  const changes = git ? git.staged.length + git.unstaged.length : 0;

  return (
    <footer className="relative flex h-[22px] shrink-0 items-stretch border-t border-line bg-[var(--status)] text-[11.5px] text-[var(--status-fg)]" aria-label="Status bar">
      <Item
        title="Switch project"
        className="font-medium"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // The menu clamps itself into the viewport, so this opens it just above the status bar.
          openProjectSwitcher({ x: r.left, y: window.innerHeight });
        }}
      >
        <FolderKanban size={12} />
        <span className="truncate">{project ? project.name : "No project"}</span>
      </Item>
      {git?.repo && (
        <Item title={`Branch ${git.branch ?? "detached"}${changes ? `, ${changes} change(s)` : ""} — open Source Control`} onClick={() => showActivity("scm")}>
          <GitBranch size={12} />
          <span className="truncate">
            {git.detached ? "(detached)" : (git.branch ?? "—")}
            {changes ? "*" : ""}
          </span>
          {(git.ahead > 0 || git.behind > 0) && (
            <span className="opacity-80">
              {git.behind ? `↓${git.behind}` : ""}
              {git.ahead ? `↑${git.ahead}` : ""}
            </span>
          )}
        </Item>
      )}
      <Item title={errors ? `${errors} error${errors === 1 ? "" : "s"} — open Output` : "No errors — open Output"} onClick={() => setPanelTab("output")} className={errors ? "text-err" : ""}>
        {errors ? <CircleAlert size={12} /> : <TriangleAlert size={12} />} {errors}
      </Item>
      <div className="flex-1" />
      <Item title={runningRuns ? `${runningRuns} agent run(s) working — open Agent Runs` : "No agents running — open Agent Runs"} onClick={() => showActivity("runs")}>
        <Bot size={12} className={runningRuns ? "animate-pulse text-accent" : ""} />
        {runningRuns ? `${runningRuns} running` : "Idle"}
      </Item>
      <Item
        title={agents.length ? `Default agent: ${label(agentId)} — ${agent?.available ? "ready" : (agent?.detail ?? "not installed")}` : "Agents loading…"}
        onClick={() => openSettings("settings-agents")}
      >
        <span className={`h-[7px] w-[7px] rounded-full ${agent?.available ? "bg-ok" : "bg-err"}`} aria-hidden />
        <span className="truncate">{agents.length ? label(agentId) : "…"}</span>
      </Item>
      <span data-bell className="contents">
      <Item
        title={`${notifications.length} notification(s)`}
        onClick={() => {
          setBellOpen((o) => !o);
          markNotificationsRead();
        }}
      >
        {unreadNotifications ? <BellDot size={13} /> : <Bell size={13} />}
      </Item>
      </span>

      {bellOpen && (
        <div ref={bellRef} className="popover absolute bottom-[26px] right-2 z-[55] w-[380px] max-w-[calc(100vw-16px)] overflow-hidden text-fg" role="dialog" aria-label="Notifications">
          <div className="flex h-8 items-center gap-2 border-b border-line px-3">
            <span className="section-title flex-1">Notifications</span>
            <button className="btn btn-ghost btn-sm" title="Clear all" aria-label="Clear all notifications" onClick={clearNotifications} disabled={!notifications.length}>
              Clear all
            </button>
            <button className="icon-btn" title="Close" aria-label="Close notifications" onClick={() => setBellOpen(false)}>
              <X size={13} />
            </button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {[...notifications].reverse().map((n) => {
              const Icon = TOAST_ICON[n.level];
              return (
                <div key={n.id} className="flex items-start gap-2.5 border-b border-line/60 px-3 py-2 last:border-0">
                  <Icon size={14} className={`mt-[2px] ${TOAST_COLOR[n.level]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[12.5px] leading-snug">{n.text}</div>
                    <div className="mt-0.5 text-[10.5px] text-faint">
                      {n.source && `${n.source} · `}
                      {timeAgo(n.ts)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!notifications.length && <div className="px-3 py-6 text-center text-[12px] text-muted">You’re all caught up</div>}
          </div>
        </div>
      )}
    </footer>
  );
}

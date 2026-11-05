"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileCode, GitBranch, Minus, Plus, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";

type StatusLetter = "M" | "A" | "D" | "R" | "C" | "U" | "T" | "?";
interface ChangeEntry {
  path: string;
  from?: string;
  status: StatusLetter;
}
interface GitStatus {
  repo: boolean;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasHead: boolean;
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  conflicts: ChangeEntry[];
}
interface LogEntry {
  hash: string;
  short: string;
  author: string;
  date: number;
  subject: string;
}

const LETTER_COLOR: Record<string, string> = {
  M: "text-warn",
  T: "text-warn",
  A: "text-ok",
  "?": "text-ok",
  D: "text-err",
  U: "text-err",
  R: "text-accent",
  C: "text-accent",
};

function letter(s: StatusLetter): string {
  return s === "?" ? "U" : s;
}

type Group = "staged" | "unstaged" | "conflicts";

/** Source control (⌘⇧G): git status, stage/unstage/discard, commit, AI commit messages. */
export default function ScmPanel() {
  const project = useActiveProject();
  const { openTab, log, version, bump } = useWorkbench();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const projectId = project?.id ?? null;
  const hasRepo = !!project?.repo_path;

  const refresh = useCallback(async () => {
    if (!projectId || !hasRepo) return;
    try {
      const [s, l] = await Promise.all([api<GitStatus>(`/api/git?projectId=${projectId}`), api<LogEntry[]>(`/api/git/log?projectId=${projectId}`)]);
      setStatus(s);
      setHistory(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, hasRepo]);

  useEffect(() => {
    setStatus(null);
    void refresh();
  }, [refresh, version]);

  // Pick up edits made in the editor/terminal when the window regains focus.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const op = useCallback(
    async (label: string, payload: Record<string, unknown>) => {
      if (!projectId) return null;
      setBusy(label);
      try {
        const r = await api<{ ok: true; commit?: string; status: GitStatus }>("/api/git", { method: "POST", json: { projectId, ...payload } });
        setStatus(r.status);
        return r;
      } catch (e) {
        log("error", "git", e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [projectId, log],
  );

  const commit = useCallback(async () => {
    if (!status || !message.trim()) return;
    if (!status.staged.length) {
      log("error", "git", "Nothing staged to commit.");
      return;
    }
    const r = await op("commit", { op: "commit", message });
    if (r?.commit) {
      log("ok", "git", `Committed ${r.commit}: ${message.split("\n")[0]}`);
      setMessage("");
      bump();
    }
  }, [status, message, op, log, bump]);

  const generate = useCallback(async () => {
    if (!projectId) return;
    setBusy("ai");
    try {
      const r = await api<{ message: string }>("/api/git/ai-message", { method: "POST", json: { projectId } });
      setMessage(r.message);
    } catch (e) {
      log("error", "git", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [projectId, log]);

  if (!project) return <p className="px-3 text-muted">Select a project.</p>;
  if (!hasRepo) return <p className="px-3 text-muted">This project has no repository linked.</p>;
  if (error)
    return (
      <div className="space-y-2 px-3">
        <p className="text-[12px] text-err">{error}</p>
        <button className="btn" onClick={() => void refresh()}>
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  if (!status) return <p className="px-3 text-muted">Loading…</p>;

  if (!status.repo)
    return (
      <div className="space-y-2 px-3">
        <p className="text-[12px] text-muted">The folder for this project is not a git repository.</p>
        <button className="btn btn-primary w-full justify-center" disabled={!!busy} onClick={() => void op("init", { op: "init" }).then(() => refresh())}>
          <GitBranch size={13} /> Initialize Repository
        </button>
      </div>
    );

  const openDiff = (e: ChangeEntry, staged: boolean) => {
    const name = e.path.split("/").pop() ?? e.path;
    openTab({ kind: "diff", projectId: project.id, path: e.path, staged, from: staged ? e.from : undefined }, `${name} (diff)`);
  };

  const discard = async (entries: ChangeEntry[]) => {
    const untracked = entries.filter((e) => e.status === "?");
    const what = entries.length === 1 ? `"${entries[0].path}"` : `${entries.length} files`;
    const ok = await confirmDialog({
      title: `Discard changes in ${what}?`,
      message: untracked.length ? `${untracked.length} untracked file${untracked.length === 1 ? " will be" : "s will be"} permanently DELETED.` : "This cannot be undone.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    void op("discard", { op: "discard", paths: entries.map((e) => e.path) });
  };

  const groups: { id: Group; title: string; items: ChangeEntry[] }[] = [
    ...(status.conflicts.length ? [{ id: "conflicts" as const, title: "Merge Changes", items: status.conflicts }] : []),
    { id: "staged", title: "Staged Changes", items: status.staged },
    { id: "unstaged", title: "Changes", items: status.unstaged },
  ];

  return (
    <div className="pb-3">
      <div className="flex items-center gap-1.5 px-3 pb-2 text-[12px] text-muted">
        <GitBranch size={13} />
        <span className="min-w-0 flex-1 truncate" title={status.upstream ?? undefined}>
          {status.branch ?? "(no branch)"}
          {status.detached && <span className="text-faint"> (detached)</span>}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="ml-1 text-faint">
              {status.behind > 0 && `↓${status.behind}`} {status.ahead > 0 && `↑${status.ahead}`}
            </span>
          )}
        </span>
        <button className="icon-btn" title="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="space-y-1.5 px-3 pb-2">
        <div className="relative">
          <textarea
            className="input min-h-[56px] pr-7 font-sans"
            rows={3}
            placeholder={`Message (⌘↵ to commit on "${status.branch ?? "HEAD"}")`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commit();
              }
            }}
          />
          <button
            className="icon-btn absolute right-1 top-1 !h-[22px] !w-[22px]"
            title="Generate commit message with AI from staged changes"
            disabled={!!busy || !status.staged.length}
            onClick={() => void generate()}
          >
            <Sparkles size={13} className={busy === "ai" ? "animate-pulse text-accent" : undefined} />
          </button>
        </div>
        <button
          className="btn btn-primary w-full justify-center"
          disabled={!!busy || !message.trim() || !status.staged.length}
          title={!status.staged.length ? "Stage changes to commit" : undefined}
          onClick={() => void commit()}
        >
          <Check size={13} /> {busy === "commit" ? "Committing…" : "Commit"}
        </button>
      </div>

      {groups.map((g) => (
        <div key={g.id}>
          <div
            className="group flex h-[22px] cursor-pointer items-center gap-1 pl-1 pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-hover"
            onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
          >
            {collapsed[g.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <span className="flex-1 truncate">{g.title}</span>
            <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
              {g.id === "staged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Unstage All" onClick={() => void op("unstage", { op: "unstage", paths: g.items.map((e) => e.path) })}>
                  <Minus size={13} />
                </button>
              )}
              {g.id === "unstaged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Discard All Changes" onClick={() => discard(g.items)}>
                  <Undo2 size={13} />
                </button>
              )}
              {g.id !== "staged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Stage All" onClick={() => void op("stage", { op: "stage", paths: g.items.map((e) => e.path) })}>
                  <Plus size={13} />
                </button>
              )}
            </span>
            <span className="ml-1 rounded-full bg-elev px-1.5 text-[10.5px] font-normal leading-4">{g.items.length}</span>
          </div>
          {!collapsed[g.id] &&
            g.items.map((e) => {
              const slash = e.path.lastIndexOf("/");
              const base = e.path.slice(slash + 1);
              const dir = slash >= 0 ? e.path.slice(0, slash) : "";
              const staged = g.id === "staged";
              return (
                <div
                  key={`${g.id}:${e.path}`}
                  className="group flex h-[22px] cursor-pointer items-center gap-1.5 pl-5 pr-2 text-[12.5px] hover:bg-hover"
                  title={e.from ? `${e.from} → ${e.path}` : e.path}
                  onClick={() => openDiff(e, staged)}
                >
                  <span className={`min-w-0 shrink truncate ${e.status === "D" ? "line-through opacity-80" : ""}`}>{base}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
                  <span className="hidden items-center group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
                    {e.status !== "D" && (
                      <button className="icon-btn !h-5 !w-5" title="Open File" onClick={() => openTab({ kind: "file", projectId: project.id, path: e.path }, base)}>
                        <FileCode size={13} />
                      </button>
                    )}
                    {g.id === "unstaged" && (
                      <button className="icon-btn !h-5 !w-5" title="Discard Changes" onClick={() => discard([e])}>
                        <Undo2 size={13} />
                      </button>
                    )}
                    {staged ? (
                      <button className="icon-btn !h-5 !w-5" title="Unstage Changes" onClick={() => void op("unstage", { op: "unstage", paths: [e.path] })}>
                        <Minus size={13} />
                      </button>
                    ) : (
                      <button className="icon-btn !h-5 !w-5" title="Stage Changes" onClick={() => void op("stage", { op: "stage", paths: [e.path] })}>
                        <Plus size={13} />
                      </button>
                    )}
                  </span>
                  <span className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold ${LETTER_COLOR[e.status] ?? "text-muted"}`} title={e.status === "?" ? "Untracked" : undefined}>
                    {letter(e.status)}
                  </span>
                </div>
              );
            })}
        </div>
      ))}

      {history.length > 0 && (
        <div className="mt-2">
          <div
            className="flex h-[22px] cursor-pointer items-center gap-1 pl-1 pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:bg-hover"
            onClick={() => setCollapsed((c) => ({ ...c, history: c.history === false }))}
          >
            {collapsed.history === false ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="flex-1">Recent Commits</span>
          </div>
          {collapsed.history === false &&
            history.map((h) => (
              <div key={h.hash} className="flex h-[22px] items-center gap-2 pl-5 pr-2 text-[12px]" title={`${h.hash}\n${h.author} · ${new Date(h.date).toLocaleString()}`}>
                <span className="shrink-0 font-mono text-[11px] text-accent">{h.short}</span>
                <span className="min-w-0 flex-1 truncate">{h.subject}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

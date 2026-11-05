"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileCode, FolderGit2, FolderPlus, GitBranch, Minus, Plus, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { ErrorState, LoadingRows } from "@/components/ui/kit";
import { openProjectSettings } from "@/components/workbench/actions";
import { kbd } from "@/components/workbench/shortcuts";

/** Rows rendered per group before a "Show more" row (a fresh repo can list thousands of files). */
const PAGE = 200;

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

const STATUS_LABEL: Record<string, string> = { M: "Modified", T: "Type changed", A: "Added", "?": "Untracked", D: "Deleted", U: "Conflict", R: "Renamed", C: "Copied" };

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
  const [limits, setLimits] = useState<Record<string, number>>({});
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

  if (!project) return <EmptyState compact icon={FolderPlus} title="No project selected" hint="Pick a project in the title bar to see its changes." />;
  if (!hasRepo)
    return <EmptyState compact icon={FolderGit2} title="No repository linked" hint="Link the project folder to track and commit changes." action={{ label: "Link a repo folder", onClick: () => openProjectSettings(project.id) }} />;
  if (error) return <ErrorState compact title="Couldn’t read the git status" error={error} onRetry={() => void refresh()} />;
  if (!status)
    return (
      <div className="pl-5 pr-3 pt-1">
        <div className="skeleton mb-2 h-[60px]" />
        <div className="skeleton mb-3 h-[28px]" />
        <LoadingRows rows={6} height={14} />
      </div>
    );

  if (!status.repo)
    return (
      <div className="space-y-2 pl-5 pr-3">
        <p className="text-[12px] leading-relaxed text-muted">This project’s folder isn’t a git repository yet. Initialize one to track changes and commit.</p>
        <button className="btn btn-primary w-full justify-center" disabled={!!busy} onClick={() => void op("init", { op: "init" }).then(() => refresh())}>
          <GitBranch size={13} /> Initialize repository
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
    ...(status.conflicts.length ? [{ id: "conflicts" as const, title: "Merge changes", items: status.conflicts }] : []),
    { id: "staged", title: "Staged changes", items: status.staged },
    { id: "unstaged", title: "Changes", items: status.unstaged },
  ];

  return (
    <div className="pb-3">
      <div className="flex h-[24px] items-center gap-1.5 pl-5 pr-2 text-[12px] text-muted">
        <GitBranch size={13} aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={status.upstream ?? undefined}>
          {status.branch ?? "(no branch)"}
          {status.detached && <span className="text-faint"> (detached)</span>}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="ml-1 text-faint">
              {status.behind > 0 && `↓${status.behind}`} {status.ahead > 0 && `↑${status.ahead}`}
            </span>
          )}
        </span>
        <button className="icon-btn" title="Refresh" aria-label="Refresh source control" aria-busy={!!busy} onClick={() => void refresh()}>
          <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="space-y-1.5 pb-2 pl-5 pr-3 pt-1">
        <div className="relative">
          <textarea
            className="input min-h-[56px] pr-7 font-sans"
            rows={3}
            aria-label="Commit message"
            placeholder={`Message (${kbd("⌘↵")} to commit on “${status.branch ?? "HEAD"}”)`}
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
            title={status.staged.length ? "Write a commit message from the staged changes" : "Stage changes to write a commit message"}
            aria-label="Write a commit message from the staged changes"
            disabled={!!busy || !status.staged.length}
            onClick={() => void generate()}
          >
            <Sparkles size={13} className={busy === "ai" ? "text-accent" : undefined} />
          </button>
        </div>
        {(() => {
          // A washed-out primary reads as "broken"; when commit isn't possible yet show a quiet button that says why.
          const ready = !busy && !!message.trim() && status.staged.length > 0;
          const why = !status.staged.length ? "Stage changes to commit" : !message.trim() ? "Write a commit message" : undefined;
          return (
            <button className={`btn w-full justify-center ${ready || busy === "commit" ? "btn-primary" : ""}`} disabled={!ready} title={why ?? `Commit to ${status.branch ?? "HEAD"} (${kbd("⌘↵")})`} onClick={() => void commit()}>
              <Check size={13} aria-hidden /> {busy === "commit" ? "Committing…" : "Commit"}
            </button>
          );
        })()}
        {!status.staged.length && status.unstaged.length > 0 && <p className="help !mt-1">Stage files with + to include them in the commit.</p>}
      </div>

      {groups.map((g) => (
        <div key={g.id}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed[g.id]}
            className="side-row group flex h-[22px] items-center gap-0.5 pl-1 pr-2 text-muted outline-none hover:bg-hover"
            onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] })))}
          >
            <span className="flex w-4 shrink-0 justify-center" aria-hidden>
              {collapsed[g.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span className="section-title flex-1 truncate">{g.title}</span>
            <span className="hidden items-center group-focus-within:flex group-hover:flex" onClick={(e) => e.stopPropagation()}>
              {g.id === "staged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Unstage all" aria-label="Unstage all" onClick={() => void op("unstage", { op: "unstage", paths: g.items.map((e) => e.path) })}>
                  <Minus size={13} />
                </button>
              )}
              {g.id === "unstaged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Discard all changes" aria-label="Discard all changes" onClick={() => discard(g.items)}>
                  <Undo2 size={13} />
                </button>
              )}
              {g.id !== "staged" && g.items.length > 0 && (
                <button className="icon-btn !h-5 !w-5" title="Stage all" aria-label="Stage all" onClick={() => void op("stage", { op: "stage", paths: g.items.map((e) => e.path) })}>
                  <Plus size={13} />
                </button>
              )}
            </span>
            <span className="count ml-1" aria-label={`${g.items.length} files`}>
              {g.items.length}
            </span>
          </div>
          {!collapsed[g.id] &&
            g.items.slice(0, limits[g.id] ?? PAGE).map((e) => {
              const slash = e.path.lastIndexOf("/");
              const base = e.path.slice(slash + 1);
              const dir = slash >= 0 ? e.path.slice(0, slash) : "";
              const staged = g.id === "staged";
              return (
                <div
                  key={`${g.id}:${e.path}`}
                  role="button"
                  tabIndex={0}
                  className="side-row group flex h-[22px] items-center gap-1.5 pl-[22px] pr-2 text-[13px] outline-none hover:bg-hover"
                  title={e.from ? `${e.from} → ${e.path}` : e.path}
                  onClick={() => openDiff(e, staged)}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget && (ev.preventDefault(), openDiff(e, staged))}
                >
                  <span className={`min-w-0 shrink truncate ${e.status === "D" ? "text-muted line-through" : ""}`}>{base}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
                  <span className="hidden items-center group-focus-within:flex group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
                    {e.status !== "D" && (
                      <button className="icon-btn !h-5 !w-5" title="Open file" aria-label={`Open ${base}`} onClick={() => openTab({ kind: "file", projectId: project.id, path: e.path }, base)}>
                        <FileCode size={13} />
                      </button>
                    )}
                    {g.id === "unstaged" && (
                      <button className="icon-btn !h-5 !w-5" title="Discard changes" aria-label={`Discard changes in ${base}`} onClick={() => discard([e])}>
                        <Undo2 size={13} />
                      </button>
                    )}
                    {staged ? (
                      <button className="icon-btn !h-5 !w-5" title="Unstage changes" aria-label={`Unstage ${base}`} onClick={() => void op("unstage", { op: "unstage", paths: [e.path] })}>
                        <Minus size={13} />
                      </button>
                    ) : (
                      <button className="icon-btn !h-5 !w-5" title="Stage changes" aria-label={`Stage ${base}`} onClick={() => void op("stage", { op: "stage", paths: [e.path] })}>
                        <Plus size={13} />
                      </button>
                    )}
                  </span>
                  <span className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold ${LETTER_COLOR[e.status] ?? "text-muted"}`} title={STATUS_LABEL[e.status] ?? e.status} aria-label={STATUS_LABEL[e.status] ?? e.status}>
                    {letter(e.status)}
                  </span>
                </div>
              );
            })}
          {!collapsed[g.id] && g.items.length > (limits[g.id] ?? PAGE) && (
            <button
              type="button"
              className="side-row flex h-[22px] w-full items-center pl-[22px] text-left text-[12px] text-accent hover:bg-hover"
              onClick={() => setLimits((l) => ({ ...l, [g.id]: (l[g.id] ?? PAGE) + PAGE }))}
            >
              Show {Math.min(PAGE, g.items.length - (limits[g.id] ?? PAGE))} more of {(g.items.length - (limits[g.id] ?? PAGE)).toLocaleString()}
            </button>
          )}
          {!collapsed[g.id] && !g.items.length && g.id === "unstaged" && <p className="py-1 pl-[22px] pr-3 text-[12px] text-faint">No changes in the working tree.</p>}
        </div>
      ))}

      {history.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={collapsed.history === false}
            className="side-row flex h-[22px] w-full items-center gap-0.5 pl-1 pr-2 text-left text-muted hover:bg-hover"
            onClick={() => setCollapsed((c) => ({ ...c, history: c.history === false }))}
          >
            <span className="flex w-4 shrink-0 justify-center" aria-hidden>
              {collapsed.history === false ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="section-title flex-1">Recent commits</span>
          </button>
          {collapsed.history === false &&
            history.map((h) => (
              <div key={h.hash} className="flex h-[22px] items-center gap-2 pl-[22px] pr-2 text-[13px]" title={`${h.hash}\n${h.author} · ${new Date(h.date).toLocaleString()}`}>
                <span className="shrink-0 font-mono text-[11px] text-accent">{h.short}</span>
                <span className="min-w-0 flex-1 truncate">{h.subject}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

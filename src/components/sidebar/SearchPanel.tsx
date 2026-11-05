"use client";
import { useEffect, useRef, useState } from "react";
import { CaseSensitive, ChevronDown, ChevronRight, File, FolderGit2, FolderPlus, Regex, Search as SearchIcon, X } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { EmptyState } from "@/components/ui/empty";
import { openProjectSettings } from "@/components/workbench/actions";

/** Files rendered before a "Show more" row (a broad query can match thousands). */
const FILE_PAGE = 100;

interface SearchMatch {
  line: number;
  text: string;
  ranges: [number, number][];
}
interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}
interface SearchResult {
  files: SearchFileResult[];
  total: number;
  truncated: boolean;
}

function Preview({ m }: { m: SearchMatch }) {
  const parts: React.ReactNode[] = [];
  // Trim leading indentation so the match stays visible in a narrow sidebar.
  const indent = m.text.length - m.text.trimStart().length;
  let pos = indent;
  m.ranges.forEach(([a, b], i) => {
    if (b <= pos) return;
    const start = Math.max(a, pos);
    if (start > pos) parts.push(m.text.slice(pos, start));
    parts.push(
      <mark key={i} className="rounded-[2px] bg-[color-mix(in_srgb,var(--warn)_35%,transparent)] text-fg">
        {m.text.slice(start, b)}
      </mark>,
    );
    pos = b;
  });
  parts.push(m.text.slice(pos));
  return <span className="truncate whitespace-pre">{parts}</span>;
}

function ToggleBtn({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-[20px] w-[22px] items-center justify-center rounded-[4px] ${on ? "bg-active text-fg shadow-[inset_0_0_0_1px_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

/** Find in files (⌘⇧F), backed by ripgrep. */
export default function SearchPanel() {
  const project = useActiveProject();
  const openTab = useWorkbench((s) => s.openTab);
  const version = useWorkbench((s) => s.version);
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [glob, setGlob] = useState("");
  const [showGlob, setShowGlob] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(FILE_PAGE);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectId = project?.id ?? null;
  const hasRepo = !!project?.repo_path;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!projectId || !hasRepo || !q) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ projectId, q, regex: regex ? "1" : "0", case: matchCase ? "1" : "0", glob });
      api<SearchResult>(`/api/search?${params}`)
        .then((r) => {
          if (my !== seq.current) return;
          setResult(r);
          setError(null);
          setCollapsed({});
          setLimit(FILE_PAGE);
        })
        .catch((e) => my === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => my === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [projectId, hasRepo, q, regex, matchCase, glob, version]);

  if (!project) return <EmptyState compact icon={FolderPlus} title="No project selected" hint="Pick a project in the title bar to search its files." />;
  if (!hasRepo)
    return <EmptyState compact icon={FolderGit2} title="No repository linked" hint="Link the project folder to search its files." action={{ label: "Link a repo folder", onClick: () => openProjectSettings(project.id) }} />;

  const fileCount = result?.files.length ?? 0;

  return (
    <div className="flex flex-col pb-3">
      <div className="space-y-1.5 pb-2 pl-5 pr-3">
        <div className="relative">
          <input
            ref={inputRef}
            className="input input-sm pr-[54px]"
            placeholder="Search"
            aria-label="Search in files"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <ToggleBtn on={matchCase} title="Match case" onClick={() => setMatchCase((v) => !v)}>
              <CaseSensitive size={15} />
            </ToggleBtn>
            <ToggleBtn on={regex} title="Use regular expression" onClick={() => setRegex((v) => !v)}>
              <Regex size={13} />
            </ToggleBtn>
          </div>
        </div>
        <button type="button" className="-ml-1 flex h-[18px] items-center gap-0.5 rounded-[4px] pr-1 text-[11px] text-muted hover:text-fg" aria-expanded={showGlob} onClick={() => setShowGlob((v) => !v)}>
          {showGlob ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Files to include
        </button>
        {showGlob && (
          <div className="relative">
            <input className="input input-sm pr-7" placeholder="e.g. *.ts, src/**" aria-label="Files to include" value={glob} onChange={(e) => setGlob(e.target.value)} />
            {glob && (
              <button className="icon-btn absolute right-0.5 top-1/2 !h-5 !w-5 -translate-y-1/2" title="Clear" aria-label="Clear files to include" onClick={() => setGlob("")}>
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {q && (
        <div className="pb-1 pl-5 pr-3 text-[12px] text-muted" role="status">
          {error ? (
            <span className="text-err">{error}</span>
          ) : loading && !result ? (
            "Searching…"
          ) : result ? (
            result.total ? (
              <>
                {result.total} result{result.total === 1 ? "" : "s"} in {fileCount} file{fileCount === 1 ? "" : "s"}
                {result.truncated && <span className="text-warn"> (limit reached)</span>}
                {loading && <span className="text-faint"> · updating…</span>}
              </>
            ) : (
              "No results. Check the spelling or widen the files to include."
            )
          ) : null}
        </div>
      )}

      {!q && (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-6 text-center text-[12px] text-muted">
          <SearchIcon size={18} strokeWidth={1.6} className="text-faint" aria-hidden />
          Type to search every file in {project.name}.
        </div>
      )}

      {result?.files.slice(0, limit).map((f) => {
        const isCollapsed = collapsed[f.path];
        const slash = f.path.lastIndexOf("/");
        const base = f.path.slice(slash + 1);
        const dir = slash >= 0 ? f.path.slice(0, slash) : "";
        return (
          <div key={f.path}>
            <button
              type="button"
              className="side-row flex h-[22px] w-full items-center gap-1 pl-2 pr-2 text-left text-[13px] hover:bg-hover"
              title={f.path}
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((c) => ({ ...c, [f.path]: !c[f.path] }))}
            >
              {isCollapsed ? <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden /> : <ChevronDown size={14} className="shrink-0 text-faint" aria-hidden />}
              <File size={14} className="shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 shrink truncate">{base}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
              <span className="count shrink-0" aria-label={`${f.matches.length} matches`}>
                {f.matches.length}
              </span>
            </button>
            {!isCollapsed &&
              f.matches.map((m, i) => (
                <button
                  type="button"
                  key={`${m.line}:${i}`}
                  className="side-row flex h-[22px] w-full items-center gap-2 pl-[38px] pr-2 text-left font-mono text-[12px] text-muted hover:bg-hover hover:text-fg"
                  title={`${f.path}:${m.line}\n${m.text.trim()}`}
                  onClick={() => projectId && openTab({ kind: "file", projectId, path: f.path }, base)}
                >
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <Preview m={m} />
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{m.line}</span>
                </button>
              ))}
          </div>
        );
      })}
      {result && result.files.length > limit && (
        <button type="button" className="side-row flex h-[22px] w-full items-center pl-7 text-left text-[12px] text-accent hover:bg-hover" onClick={() => setLimit((l) => l + FILE_PAGE)}>
          Show {Math.min(FILE_PAGE, result.files.length - limit)} more files of {(result.files.length - limit).toLocaleString()}
        </button>
      )}
    </div>
  );
}

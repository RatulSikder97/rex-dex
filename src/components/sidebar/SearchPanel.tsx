"use client";
import { useEffect, useRef, useState } from "react";
import { CaseSensitive, ChevronDown, ChevronRight, File, Regex, X } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";

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
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-[20px] w-[22px] items-center justify-center rounded-[3px] ${on ? "bg-active text-fg ring-1 ring-accent" : "text-muted hover:bg-hover hover:text-fg"}`}
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
        })
        .catch((e) => my === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => my === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [projectId, hasRepo, q, regex, matchCase, glob, version]);

  if (!project) return <p className="px-3 text-muted">Select a project.</p>;
  if (!hasRepo) return <p className="px-3 text-muted">This project has no repository linked.</p>;

  const fileCount = result?.files.length ?? 0;

  return (
    <div className="flex flex-col pb-3">
      <div className="space-y-1.5 px-3 pb-2">
        <div className="relative">
          <input
            ref={inputRef}
            className="input pr-[54px]"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <ToggleBtn on={matchCase} title="Match Case" onClick={() => setMatchCase((v) => !v)}>
              <CaseSensitive size={15} />
            </ToggleBtn>
            <ToggleBtn on={regex} title="Use Regular Expression" onClick={() => setRegex((v) => !v)}>
              <Regex size={13} />
            </ToggleBtn>
          </div>
        </div>
        <button className="text-[11px] text-faint hover:text-fg" onClick={() => setShowGlob((v) => !v)}>
          {showGlob ? "▾" : "▸"} files to include
        </button>
        {showGlob && (
          <div className="relative">
            <input className="input pr-7" placeholder="e.g. *.ts, src/**" value={glob} onChange={(e) => setGlob(e.target.value)} />
            {glob && (
              <button className="icon-btn absolute right-0.5 top-1/2 !h-5 !w-5 -translate-y-1/2" title="Clear" onClick={() => setGlob("")}>
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {q && (
        <div className="px-3 pb-1 text-[11.5px] text-muted">
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
              "No results found."
            )
          ) : null}
        </div>
      )}

      {result?.files.map((f) => {
        const isCollapsed = collapsed[f.path];
        const slash = f.path.lastIndexOf("/");
        const base = f.path.slice(slash + 1);
        const dir = slash >= 0 ? f.path.slice(0, slash) : "";
        return (
          <div key={f.path}>
            <div
              className="group flex h-[22px] cursor-pointer items-center gap-1 pl-2 pr-2 text-[12.5px] hover:bg-hover"
              title={f.path}
              onClick={() => setCollapsed((c) => ({ ...c, [f.path]: !c[f.path] }))}
            >
              {isCollapsed ? <ChevronRight size={13} className="text-faint" /> : <ChevronDown size={13} className="text-faint" />}
              <File size={14} className="text-faint" />
              <span className="shrink-0 truncate">{base}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
              <span className="shrink-0 rounded-full bg-elev px-1.5 text-[10.5px] leading-4 text-muted">{f.matches.length}</span>
            </div>
            {!isCollapsed &&
              f.matches.map((m, i) => (
                <div
                  key={`${m.line}:${i}`}
                  className="flex h-[22px] cursor-pointer items-center gap-2 pl-[38px] pr-2 font-mono text-[11.5px] text-muted hover:bg-hover hover:text-fg"
                  title={`${f.path}:${m.line}`}
                  onClick={() => projectId && openTab({ kind: "file", projectId, path: f.path }, base)}
                >
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <Preview m={m} />
                  </span>
                  <span className="shrink-0 text-[10.5px] text-faint">{m.line}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

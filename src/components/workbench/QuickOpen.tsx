"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { File } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";

const MAX_RESULTS = 60;

interface Scored {
  path: string;
  score: number;
  /** Matched character indices within `path`. */
  hits: number[];
}

/**
 * Fuzzy subsequence match. Prefers matches inside the basename, contiguous runs,
 * and matches at word boundaries; shorter paths win ties.
 */
function fuzzy(path: string, q: string): Scored | null {
  if (!q) return { path, score: -path.length, hits: [] };
  const lower = path.toLowerCase();
  const baseStart = path.lastIndexOf("/") + 1;

  // Try anchoring the query to the basename first (greedy from the right segment), then the whole path.
  const attempt = (from: number): number[] | null => {
    const hits: number[] = [];
    let i = from;
    for (const ch of q) {
      const j = lower.indexOf(ch, i);
      if (j < 0) return null;
      hits.push(j);
      i = j + 1;
    }
    return hits;
  };
  const hits = attempt(baseStart) ?? attempt(0);
  if (!hits) return null;

  let score = 0;
  for (let k = 0; k < hits.length; k++) {
    const h = hits[k];
    score += 1;
    if (h >= baseStart) score += 2;
    if (k > 0 && hits[k - 1] === h - 1) score += 4;
    const prev = path[h - 1];
    if (h === 0 || prev === "/" || prev === "-" || prev === "_" || prev === "." || (prev && prev === prev.toLowerCase() && path[h] !== path[h].toLowerCase())) score += 3;
  }
  const base = lower.slice(baseStart);
  if (base.startsWith(q)) score += 10;
  if (base === q || base.split(".")[0] === q) score += 15;
  score -= path.length * 0.02;
  return { path, score, hits };
}

function Highlight({ text, hits, offset }: { text: string; hits: Set<number>; offset: number }) {
  return (
    <>
      {text.split("").map((c, i) => (
        <span key={i} className={hits.has(i + offset) ? "font-semibold text-accent" : undefined}>
          {c}
        </span>
      ))}
    </>
  );
}

/** ⌘P quick open: fuzzy file finder for the active project. Rendered inside the palette overlay. */
export default function QuickOpen({ onClose }: { onClose: () => void }) {
  const project = useActiveProject();
  const openTab = useWorkbench((s) => s.openTab);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const projectId = project?.id ?? null;
  const hasRepo = !!project?.repo_path;

  useEffect(() => {
    if (!projectId || !hasRepo) return;
    let cancelled = false;
    api<{ files: string[]; truncated: boolean }>(`/api/files?mode=all&projectId=${projectId}`)
      .then((r) => !cancelled && setFiles(r.files))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId, hasRepo]);

  const results = useMemo(() => {
    if (!files) return [];
    const needle = q.toLowerCase().replace(/\s+/g, "");
    const out: Scored[] = [];
    for (const f of files) {
      const s = fuzzy(f, needle);
      if (s) out.push(s);
    }
    out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return out.slice(0, MAX_RESULTS);
  }, [files, q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const open = (r?: Scored) => {
    if (!r || !projectId) return;
    openTab({ kind: "file", projectId, path: r.path }, r.path.split("/").pop() ?? r.path);
    onClose();
  };

  let hint: string | null = null;
  if (!project) hint = "Select a project to search its files.";
  else if (!hasRepo) hint = "This project has no repository linked. Set a repo path in project settings.";
  else if (error) hint = error;
  else if (!files) hint = "Indexing files…";
  else if (!results.length) hint = "No matching files.";

  return (
    <div>
      <input
        autoFocus
        className="h-10 w-full border-b border-line bg-transparent px-4 text-[13px] outline-none"
        placeholder={project ? `Search files in ${project.name} by name…` : "Search files by name…"}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            open(results[idx]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
        {hint ? (
          <div className="px-4 py-3 text-[12px] text-muted">{hint}</div>
        ) : (
          results.map((r, i) => {
            const slash = r.path.lastIndexOf("/");
            const base = r.path.slice(slash + 1);
            const dir = slash >= 0 ? r.path.slice(0, slash) : "";
            const hits = new Set(r.hits);
            return (
              <div
                key={r.path}
                data-idx={i}
                onMouseMove={() => i !== idx && setIdx(i)}
                onClick={() => open(r)}
                className={`flex h-[24px] cursor-pointer items-center gap-2 px-4 text-[12.5px] ${i === idx ? "bg-active text-fg" : "text-fg"}`}
              >
                <File size={14} className="text-faint" />
                <span className="shrink-0 whitespace-pre">
                  <Highlight text={base} hits={hits} offset={slash + 1} />
                </span>
                {dir && (
                  <span className="min-w-0 truncate whitespace-pre text-[11.5px] text-faint">
                    <Highlight text={dir} hits={hits} offset={0} />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      {files && files.length >= 20000 && <div className="border-t border-line px-4 py-1 text-[11px] text-faint">Showing the first 20,000 files.</div>}
    </div>
  );
}

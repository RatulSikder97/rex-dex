"use client";
import { useCallback, useEffect, useState } from "react";
import { MONACO_THEME, monacoBeforeMount } from "@/components/ui/colorTheme";
import dynamic from "next/dynamic";
import { FileCode, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import { useWorkbench } from "@/store/workbench";
import { useEditorOptions } from "./editorOptions";

const MonacoDiff = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => <div className="p-4 text-muted">Loading diff…</div>,
});

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", mdx: "markdown", css: "css", scss: "scss", less: "less", html: "html", py: "python", go: "go", java: "java",
  kt: "kotlin", rs: "rust", rb: "ruby", php: "php", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift", sql: "sql",
  yml: "yaml", yaml: "yaml", sh: "shell", bash: "shell", zsh: "shell", toml: "ini", ini: "ini", xml: "xml", svg: "xml", graphql: "graphql",
  gql: "graphql", prisma: "graphql", dockerfile: "dockerfile", vue: "html", svelte: "html",
};

function languageFor(path: string): string {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return LANG[ext] ?? "plaintext";
}

interface Versions {
  head: string | null;
  index: string | null;
  working: string | null;
  binary: boolean;
}

/** Side-by-side diff of a changed file: HEAD↔index for staged changes, index↔working tree otherwise. */
export default function DiffView({ projectId, path, staged, from }: { projectId: string; path: string; staged: boolean; from?: string }) {
  const { openTab, version } = useWorkbench();
  const [v, setV] = useState<Versions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { options: editorOptions } = useEditorOptions();

  const load = useCallback(() => {
    api<Versions>(`/api/git/show?projectId=${projectId}&path=${encodeURIComponent(path)}${from ? `&from=${encodeURIComponent(from)}` : ""}`)
      .then((r) => {
        setV(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId, path, from]);

  useEffect(() => {
    load();
  }, [load, version]);

  const name = path.split("/").pop() ?? path;
  const header = (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
      <span className="truncate font-mono">{from ? `${from} → ${path}` : path}</span>
      <span className="text-faint">{staged ? "HEAD ↔ Index (staged)" : "Index ↔ Working Tree"}</span>
      <div className="flex-1" />
      <button className="icon-btn" title="Refresh" onClick={load}>
        <RefreshCw size={13} />
      </button>
      <button className="btn btn-ghost" onClick={() => openTab({ kind: "file", projectId, path }, name)}>
        <FileCode size={13} /> Open File
      </button>
    </div>
  );

  if (error)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="p-6 text-err">{error}</div>
      </div>
    );
  if (!v)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="p-6 text-muted">Loading…</div>
      </div>
    );
  if (v.binary)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="p-6 text-muted">Binary file; diff not shown.</div>
      </div>
    );

  const original = staged ? (v.head ?? "") : (v.index ?? v.head ?? "");
  const modified = staged ? (v.index ?? "") : (v.working ?? "");

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">
        <MonacoDiff
          height="100%"
          theme={MONACO_THEME}
          beforeMount={monacoBeforeMount}
          language={languageFor(path)}
          original={original}
          modified={modified}
          originalModelPath={`diff-original/${projectId}/${staged ? "staged" : "work"}/${path}`}
          modifiedModelPath={`diff-modified/${projectId}/${staged ? "staged" : "work"}/${path}`}
          options={{
            ...editorOptions,
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
          }}
        />
      </div>
    </div>
  );
}

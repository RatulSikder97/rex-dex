"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Bot, Save } from "lucide-react";
import { api } from "@/lib/client";
import { useWorkbench } from "@/store/workbench";
import { MONACO_THEME, monacoBeforeMount } from "@/components/ui/colorTheme";
import { getSetting } from "@/store/settings";
import { registerEditor } from "@/components/workbench/editorRegistry";
import { useEditorOptions } from "./editorOptions";
import { kbd } from "@/components/workbench/shortcuts";
import { ErrorState, LoadingRows } from "@/components/ui/kit";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), { ssr: false, loading: () => <LoadingRows rows={10} height={12} className="p-4" /> });

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json",
  md: "markdown", css: "css", scss: "scss", html: "html", py: "python", go: "go", java: "java", kt: "kotlin", rs: "rust",
  sql: "sql", yml: "yaml", yaml: "yaml", sh: "shell", toml: "ini", xml: "xml", svg: "xml", dockerfile: "dockerfile", prisma: "graphql",
};

const LANG_LABEL: Record<string, string> = { typescript: "TypeScript", javascript: "JavaScript", json: "JSON", markdown: "Markdown", css: "CSS", html: "HTML", python: "Python", plaintext: "Plain text" };

export default function FileEditor({ tabId, projectId, path }: { tabId: string; projectId: string; path: string }) {
  const { setTabDirty, log, delegate } = useWorkbench();
  const [content, setContent] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const saved = useRef("");
  const current = useRef("");
  const { options, modelOptions } = useEditorOptions();
  const editorRef = useRef<import("monaco-editor").editor.ICodeEditor | null>(null);

  useEffect(() => {
    api<{ content: string; binary: boolean }>(`/api/files?mode=read&projectId=${projectId}&path=${encodeURIComponent(path)}`)
      .then((f) => {
        setLoadError(null);
        setBinary(f.binary);
        setContent(f.content);
        saved.current = f.content;
        current.current = f.content;
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [projectId, path, attempt]);

  const save = useCallback(async () => {
    try {
      await api("/api/files", { method: "PUT", json: { projectId, path, content: current.current } });
      saved.current = current.current;
      setTabDirty(tabId, false);
      log("ok", "editor", `Saved ${path}`);
    } catch (e) {
      log("error", "editor", String(e));
    }
  }, [projectId, path, tabId, setTabDirty, log]);
  const saveRef = useRef(save);
  saveRef.current = save;
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty = () => current.current !== saved.current;

  // File > Save / Save All (menu bar, ⌘S outside Monaco).
  useEffect(() => {
    const onSave = (e: Event) => {
      const id = (e as CustomEvent<{ tabId?: string } | undefined>).detail?.tabId;
      if (!id || id === tabId) void saveRef.current();
    };
    const onSaveAll = () => isDirty() && void saveRef.current();
    window.addEventListener("rex:save", onSave);
    window.addEventListener("rex:save-all", onSaveAll);
    return () => {
      window.removeEventListener("rex:save", onSave);
      window.removeEventListener("rex:save-all", onSaveAll);
    };
  }, [tabId]);

  // files.autoSave = onFocusChange: save when the window loses focus; any mode except "off" also saves on tab switch (unmount).
  useEffect(() => {
    const onBlur = () => getSetting("files.autoSave") === "onFocusChange" && isDirty() && void saveRef.current();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      if (autoTimer.current) clearTimeout(autoTimer.current);
      // Only on tab switch: a closed tab ("Don't save") must not be written.
      const stillOpen = useWorkbench.getState().tabs.some((t) => t.id === tabId);
      if (stillOpen && getSetting("files.autoSave") !== "off" && isDirty()) void saveRef.current();
    };
  }, [tabId]);

  // editor.tabSize / insertSpaces are model options.
  useEffect(() => {
    editorRef.current?.getModel()?.updateOptions(modelOptions);
  }, [modelOptions]);

  if (loadError) return <ErrorState title={`Couldn’t open ${path.split("/").pop()}`} error={`${loadError}. Check that the file still exists in the project folder.`} onRetry={() => setAttempt((n) => n + 1)} />;
  if (binary) return <div className="p-6 text-[12.5px] text-muted">This is a binary or very large file, so it isn’t shown in the editor.</div>;
  if (content === null) return <LoadingRows rows={10} height={12} className="p-4" />;

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const language = path.toLowerCase().endsWith("dockerfile") ? "dockerfile" : (LANG[ext] ?? "plaintext");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[30px] shrink-0 items-center gap-1 border-b border-line pl-3 pr-1.5 text-[12px] text-muted" role="toolbar" aria-label="Editor actions">
        <span className="truncate">{LANG_LABEL[language] ?? language}</span>
        <div className="flex-1" />
        <button
          className="btn btn-ghost btn-sm"
          title="Ask the Engineering department to review this file"
          onClick={() =>
            delegate({
              department: "engineering",
              brief: `Review ${path} and propose concrete improvements.`,
              context: `File: ${path}\n\`\`\`${language}\n${current.current}\n\`\`\``,
            })
          }
        >
          <Bot size={13} aria-hidden /> Ask Engineering
        </button>
        <button className="btn btn-sm" onClick={save} title={`Save (${kbd("⌘S")})`}>
          <Save size={13} aria-hidden /> Save
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Monaco
          height="100%"
          theme={MONACO_THEME}
          beforeMount={monacoBeforeMount}
          path={`${projectId}/${path}`}
          defaultLanguage={language}
          defaultValue={content}
          options={options}
          onChange={(v) => {
            current.current = v ?? "";
            const dirty = current.current !== saved.current;
            setTabDirty(tabId, dirty);
            if (autoTimer.current) clearTimeout(autoTimer.current);
            if (dirty && getSetting("files.autoSave") === "afterDelay")
              autoTimer.current = setTimeout(() => isDirty() && void saveRef.current(), getSetting<number>("files.autoSaveDelay"));
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            editor.getModel()?.updateOptions(modelOptions);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
            editor.onDidBlurEditorWidget(() => getSetting("files.autoSave") === "onFocusChange" && isDirty() && void saveRef.current());
            const unregister = registerEditor(tabId, editor);
            editor.onDidDispose(unregister);
          }}
        />
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save, Settings } from "lucide-react";
import type { editor } from "monaco-editor";
import { useWorkbench } from "@/store/workbench";
import { useSettingsStore } from "@/store/settings";
import { SETTINGS } from "@/lib/userSettings";
import { MONACO_THEME, monacoBeforeMount } from "@/components/ui/colorTheme";
import { registerEditor } from "@/components/workbench/editorRegistry";
import { kbd } from "@/components/workbench/shortcuts";
import { useEditorOptions } from "@/components/views/editorOptions";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.default), { ssr: false, loading: () => (
    <div className="space-y-1.5 p-4" aria-busy="true" aria-label="Loading editor">
      {[60, 44, 52, 38].map((w, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />
      ))}
    </div>
  ),
});

const MODEL_PATH = "rex://settings/settings.json";

const serialize = (values: Record<string, unknown>) => {
  const sorted = Object.fromEntries(Object.keys(values).sort().map((k) => [k, values[k]]));
  return JSON.stringify(sorted, null, 2) + "\n";
};

/** Removes // and /* *\/ comments and trailing commas outside strings (JSONC → JSON). */
export function stripJsonc(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** JSON schema for Monaco validation + key completion. */
function jsonSchema() {
  const properties: Record<string, unknown> = {};
  for (const d of SETTINGS) {
    const base = { description: `${d.title}: ${d.description}`, default: d.default };
    if (d.type === "boolean") properties[d.key] = { ...base, type: "boolean" };
    else if (d.type === "number") properties[d.key] = { ...base, type: "number", minimum: d.min, maximum: d.max };
    else if (d.type === "enum") properties[d.key] = { ...base, enum: d.options, enumDescriptions: d.labels };
    else properties[d.key] = { ...base, type: "string" };
  }
  return { type: "object", properties, additionalProperties: false };
}

/** User settings as editable JSON (only overridden values, like VS Code's settings.json). */
export default function SettingsJsonView({ tabId }: { tabId: string }) {
  const values = useSettingsStore((s) => s.values);
  const importJson = useSettingsStore((s) => s.importJson);
  const { setTabDirty, log, toast, openSettings } = useWorkbench();
  const { options } = useEditorOptions();
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<editor.ICodeEditor | null>(null);
  const saved = useRef(serialize(values));
  const dirty = useRef(false);

  // Reflect changes made elsewhere (settings UI, menus) while there are no local edits.
  useEffect(() => {
    const text = serialize(values);
    saved.current = text;
    const ed = editorRef.current;
    if (ed && !dirty.current && ed.getValue() !== text) ed.setValue(text);
  }, [values]);

  const save = useCallback(() => {
    const text = editorRef.current?.getValue() ?? "";
    let obj: unknown;
    try {
      obj = JSON.parse(stripJsonc(text).trim() || "{}");
    } catch (e) {
      const msg = `settings.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      setError(msg);
      log("error", "settings", msg);
      return;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      setError("settings.json must contain a JSON object.");
      return;
    }
    const { applied, rejected } = importJson(obj);
    dirty.current = false;
    setTabDirty(tabId, false);
    const canonical = serialize(useSettingsStore.getState().values);
    editorRef.current?.setValue(canonical);
    saved.current = canonical;
    if (rejected.length) {
      const msg = `Ignored ${rejected.length} unknown or invalid setting${rejected.length === 1 ? "" : "s"}: ${rejected.join(", ")}`;
      setError(msg);
      toast("warn", msg, "settings");
    } else {
      setError(null);
      log("ok", "settings", `Saved settings.json (${applied.length} value${applied.length === 1 ? "" : "s"})`);
    }
  }, [importJson, log, setTabDirty, tabId, toast]);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onSave = (e: Event) => {
      const id = (e as CustomEvent<{ tabId?: string } | undefined>).detail?.tabId;
      if (!id || id === tabId) saveRef.current();
    };
    const onSaveAll = () => dirty.current && saveRef.current();
    window.addEventListener("rex:save", onSave);
    window.addEventListener("rex:save-all", onSaveAll);
    return () => {
      window.removeEventListener("rex:save", onSave);
      window.removeEventListener("rex:save-all", onSaveAll);
    };
  }, [tabId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-muted">
        <span className="min-w-0 flex-1 truncate" title="User settings. Only values that differ from the defaults are stored.">
          User settings · only values that differ from the defaults are stored
        </span>
        <button className="btn btn-ghost btn-sm shrink-0" onClick={() => openSettings()}>
          <Settings size={13} /> Open settings editor
        </button>
        <button className="btn btn-sm shrink-0" onClick={() => saveRef.current()}>
          <Save size={13} /> Save <span className="kbd">{kbd("⌘S")}</span>
        </button>
      </div>
      {error && (
        <div role="alert" className="shrink-0 border-b border-line bg-[color-mix(in_srgb,var(--err)_12%,transparent)] px-3 py-1.5 text-[12px] text-err">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Monaco
          height="100%"
          theme={MONACO_THEME}
          path={MODEL_PATH}
          defaultLanguage="json"
          defaultValue={saved.current}
          options={options}
          beforeMount={(monaco) => {
            monacoBeforeMount(monaco);
            try {
              // monaco-editor ≥0.50 exposes JSON defaults under languages.json.
              const json = (monaco.languages as unknown as { json?: { jsonDefaults?: { setDiagnosticsOptions: (o: unknown) => void } } }).json;
              json?.jsonDefaults?.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: "ignore", schemas: [{ uri: "rex://schemas/settings.json", fileMatch: [MODEL_PATH], schema: jsonSchema() }] });
            } catch {
              /* JSON language service unavailable: validation happens on save */
            }
          }}
          onChange={(v) => {
            const d = (v ?? "") !== saved.current;
            dirty.current = d;
            setTabDirty(tabId, d);
          }}
          onMount={(ed, monaco) => {
            editorRef.current = ed;
            if (ed.getValue() !== saved.current && !dirty.current) ed.setValue(saved.current);
            ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
            const unregister = registerEditor(tabId, ed);
            ed.onDidDispose(unregister);
          }}
        />
      </div>
    </div>
  );
}

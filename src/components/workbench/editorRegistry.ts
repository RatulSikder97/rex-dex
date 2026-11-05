"use client";
import type { editor } from "monaco-editor";
import { useWorkbench } from "@/store/workbench";

/**
 * Tracks mounted Monaco code editors by tab id so workbench menus (Edit, Selection)
 * can run editor actions against the editor of the active tab even after focus
 * moved into the menu.
 */
const editors = new Map<string, editor.ICodeEditor>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function registerEditor(tabId: string, ed: editor.ICodeEditor): () => void {
  editors.set(tabId, ed);
  emit();
  return () => {
    if (editors.get(tabId) === ed) editors.delete(tabId);
    emit();
  };
}

export function subscribeEditors(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The Monaco editor of the active tab, if that tab is a code editor. */
export function activeEditor(): editor.ICodeEditor | null {
  const id = useWorkbench.getState().activeTabId;
  return (id && editors.get(id)) || null;
}

/** Focuses the active editor and runs a Monaco action / command. Returns false when there is no editor. */
export function runEditorAction(actionId: string): boolean {
  const ed = activeEditor();
  if (!ed) return false;
  ed.focus();
  const action = ed.getAction(actionId);
  if (action) void action.run();
  else ed.trigger("menu", actionId, null);
  return true;
}

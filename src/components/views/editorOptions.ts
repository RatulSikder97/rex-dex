"use client";
import { useMemo } from "react";
import type { editor } from "monaco-editor";
import { useSetting } from "@/store/settings";

/**
 * Monaco options derived from the user's editor.* settings. @monaco-editor/react applies
 * `options` changes via updateOptions, so editors update live; `modelOptions` (tabSize,
 * insertSpaces) must be applied to the model by the caller.
 */
export function useEditorOptions(): { options: editor.IStandaloneEditorConstructionOptions; modelOptions: editor.ITextModelUpdateOptions } {
  const fontSize = useSetting<number>("editor.fontSize");
  const fontFamily = useSetting<string>("editor.fontFamily");
  const tabSize = useSetting<number>("editor.tabSize");
  const insertSpaces = useSetting<boolean>("editor.insertSpaces");
  const wordWrap = useSetting<string>("editor.wordWrap");
  const minimap = useSetting<boolean>("editor.minimap");
  const lineNumbers = useSetting<string>("editor.lineNumbers");
  const renderWhitespace = useSetting<string>("editor.renderWhitespace");
  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontSize,
      fontFamily,
      wordWrap: wordWrap as "off" | "on" | "bounded",
      minimap: { enabled: minimap },
      lineNumbers: lineNumbers as "on" | "off" | "relative",
      renderWhitespace: renderWhitespace as "none" | "boundary" | "selection" | "trailing" | "all",
      detectIndentation: false,
      tabSize,
      insertSpaces,
      scrollBeyondLastLine: false,
      automaticLayout: true,
    }),
    [fontSize, fontFamily, wordWrap, minimap, lineNumbers, renderWhitespace, tabSize, insertSpaces],
  );
  const modelOptions = useMemo(() => ({ tabSize, insertSpaces }), [tabSize, insertSpaces]);
  return { options, modelOptions };
}

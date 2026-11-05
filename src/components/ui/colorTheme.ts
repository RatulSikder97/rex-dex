"use client";
import type { Monaco } from "@monaco-editor/react";
import type { THEME_TOKENS } from "@/lib/plugins/types";
import type { PluginTheme } from "@/store/workbench";
import { applyThemePref, resolveTheme, type ThemePref } from "./theme";

/**
 * Contributed color themes (extensions' `themes`): applied as inline `--<token>` CSS
 * variables on <html>, with `data-theme` set to the theme's kind. The resolved vars are
 * cached in localStorage (`rex-theme-vars`) so the boot script can paint them before
 * React hydrates. The user's accent color (appearance.accentColor) overrides the theme's.
 */

type Token = (typeof THEME_TOKENS)[number];
export const COLOR_TOKENS = [
  "bg", "bg-editor", "bg-side", "bg-activity", "bg-panel", "bg-elev", "bg-hover", "bg-active", "bg-input", "bg-title",
  "border", "fg", "fg-muted", "fg-faint", "accent", "accent-fg", "ok", "warn", "err", "status", "status-fg", "shadow", "selection",
] as const satisfies readonly Token[];

export const THEME_VARS_KEY = "rex-theme-vars";

export interface AppearanceInput {
  /** Contributed theme id; "" = built-in. */
  colorTheme: string;
  /** Built-in theme preference (used when colorTheme is "" or not installed). */
  themePref: ThemePref;
  accent: string;
  themes: PluginTheme[];
  /** Write the result to localStorage for the boot script (false while previewing). */
  persist?: boolean;
}

/** Applies the effective appearance to <html>. Returns the contributed theme in effect, if any. */
export function applyAppearance({ colorTheme, themePref, accent, themes, persist = true }: AppearanceInput): PluginTheme | null {
  const root = document.documentElement;
  const theme = colorTheme ? (themes.find((t) => t.id === colorTheme) ?? null) : null;
  const vars: Record<string, string> = {};
  if (theme) for (const [k, v] of Object.entries(theme.colors)) if (v) vars[`--${k}`] = v;
  if (accent) {
    vars["--accent"] = accent;
    vars["--status"] = accent;
    vars["--selection"] = `color-mix(in srgb, ${accent} 32%, transparent)`;
    vars["--bg-active"] = `color-mix(in srgb, ${accent} 34%, var(--bg-side))`;
  }
  for (const t of COLOR_TOKENS) {
    const name = `--${t}`;
    if (vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  if (theme) {
    root.dataset.colorTheme = theme.id;
    root.dataset.colorThemeKind = theme.kind;
  } else {
    delete root.dataset.colorTheme;
    delete root.dataset.colorThemeKind;
  }
  // Re-resolves data-theme (honors colorThemeKind) and notifies Monaco/xterm listeners.
  applyThemePref(themePref);
  if (persist) {
    try {
      if (Object.keys(vars).length) localStorage.setItem(THEME_VARS_KEY, JSON.stringify({ id: theme?.id ?? "", kind: theme?.kind ?? "", vars }));
      else localStorage.removeItem(THEME_VARS_KEY);
    } catch {
      /* storage blocked */
    }
  }
  return theme;
}

/** The kind (dark/light) a picker entry would produce. */
export const kindOf = (colorTheme: string, themePref: ThemePref, themes: PluginTheme[]) =>
  themes.find((t) => t.id === colorTheme)?.kind ?? (typeof window === "undefined" ? "dark" : resolveTheme(themePref));

// ---------------------------------------------------------------- Monaco

let probe: HTMLSpanElement | null = null;

/** Resolves any CSS color (var(), rgba(), color-mix()) to #rrggbb[aa] for Monaco. */
export function cssColorHex(value: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = value;
  const c = getComputedStyle(probe).color;
  const nums = c.match(/[\d.]+(e-?\d+)?/g)?.map(Number);
  if (!nums || nums.length < 3) return fallback;
  // color(srgb r g b / a) uses 0–1 channels; rgb()/rgba() uses 0–255. Alpha is 0–1 in both.
  const unit = c.startsWith("color(");
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  const ch = (n: number) => hex(unit ? n * 255 : n);
  const a = nums.length > 3 ? nums[3] : 1;
  return `#${ch(nums[0])}${ch(nums[1])}${ch(nums[2])}${a < 1 ? hex(a * 255) : ""}`;
}

/** Monaco theme name that follows the workbench colors. */
export const MONACO_THEME = "rex";

/** (Re)defines the `rex` Monaco theme from the current CSS variables. */
export function defineMonacoTheme(monaco: Monaco) {
  const light = document.documentElement.dataset.theme === "light";
  const v = (name: string, fb: string) => cssColorHex(`var(${name})`, fb);
  const bg = v("--bg-editor", light ? "#ffffff" : "#1e1f22");
  const fg = v("--fg", light ? "#1e1f22" : "#dfe1e5");
  const faint = v("--fg-faint", light ? "#9a9ca3" : "#6f737a");
  const sel = v("--selection", light ? "#add6ff" : "#264f78");
  monaco.editor.defineTheme(MONACO_THEME, {
    base: light ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorLineNumber.foreground": faint,
      "editorLineNumber.activeForeground": fg,
      "editor.lineHighlightBackground": v("--bg-hover", light ? "#f2f3f5" : "#26282e"),
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": sel,
      "editor.inactiveSelectionBackground": sel,
      "editorCursor.foreground": v("--accent", "#3574f0"),
      "editorGutter.background": bg,
      "minimap.background": bg,
      "editorWidget.background": v("--bg-elev", light ? "#ffffff" : "#2b2d30"),
      "editorWidget.border": v("--border", light ? "#e1e3e6" : "#393b40"),
      "input.background": v("--bg-input", light ? "#ffffff" : "#1e1f22"),
      "scrollbarSlider.background": `${faint.slice(0, 7)}40`,
      "scrollbarSlider.hoverBackground": `${faint.slice(0, 7)}66`,
    },
  });
}

let watching = false;
let mon: Monaco | null = null;

/**
 * `beforeMount` for every Monaco editor: defines the `rex` theme and keeps it in sync
 * with <html> (data-theme + inline vars) for all editors (setTheme is global in Monaco).
 */
export function monacoBeforeMount(monaco: Monaco) {
  mon = monaco;
  defineMonacoTheme(monaco);
  if (watching || typeof MutationObserver === "undefined") return;
  watching = true;
  let raf = 0;
  let last = "";
  new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const root = document.documentElement;
      const sig = `${root.dataset.theme}|${COLOR_TOKENS.map((t) => root.style.getPropertyValue(`--${t}`)).join(",")}`;
      if (sig === last || !mon) return;
      last = sig;
      defineMonacoTheme(mon);
      mon.editor.setTheme(MONACO_THEME);
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
}

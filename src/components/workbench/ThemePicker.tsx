"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Palette, Search } from "lucide-react";
import { useWorkbench, type PluginTheme } from "@/store/workbench";
import { getSetting, useSettingsStore } from "@/store/settings";
import { applyAppearance } from "@/components/ui/colorTheme";
import type { ThemePref } from "@/components/ui/theme";
import { openExtensions } from "./actions";

/**
 * Color Theme quick pick (VS Code ⌘K ⌘T): built-ins + installed extension themes,
 * arrow keys live-preview, Enter applies, Esc reverts. Also exports the shared mini
 * preview and the apply/browse helpers used by Settings, Extensions and the menus.
 */

type Colors = Partial<Record<string, string>>;

/** Representative colors of the built-in themes (mirrors :root tokens in globals.css). */
const BASE: Record<"dark" | "light", Colors> = {
  dark: { bg: "#1e1f22", "bg-editor": "#1f2023", "bg-side": "#2b2d30", "bg-activity": "#2b2d30", "bg-title": "#2b2d30", border: "#393b40", fg: "#dfe1e5", "fg-faint": "#6f737a", accent: "#3574f0", ok: "#5fb865", warn: "#e5c07b", err: "#f75464", status: "#3574f0" },
  light: { bg: "#f7f8fa", "bg-editor": "#ffffff", "bg-side": "#f2f3f5", "bg-activity": "#ebecf0", "bg-title": "#ebecf0", border: "#dcdee3", fg: "#1e1f22", "fg-faint": "#8c8f96", accent: "#3574f0", ok: "#208a3c", warn: "#a8710a", err: "#d0303f", status: "#3574f0" },
};

export interface ThemeChoice {
  /** "builtin:dark" | "builtin:light" | "builtin:system" | contributed theme id */
  id: string;
  label: string;
  kind: "dark" | "light" | "system";
  group: "Built-in" | "Light themes" | "Dark themes";
  colors: Colors;
  pluginId?: string;
}

export const BUILTIN_CHOICES: ThemeChoice[] = [
  { id: "builtin:dark", label: "Dark", kind: "dark", group: "Built-in", colors: BASE.dark },
  { id: "builtin:light", label: "Light", kind: "light", group: "Built-in", colors: BASE.light },
  { id: "builtin:system", label: "System", kind: "system", group: "Built-in", colors: BASE.dark },
];

export const choiceOf = (t: PluginTheme): ThemeChoice => ({
  id: t.id,
  label: t.label,
  kind: t.kind,
  group: t.kind === "light" ? "Light themes" : "Dark themes",
  colors: { ...BASE[t.kind], ...t.colors },
  pluginId: t.pluginId,
});

export function themeChoices(themes: PluginTheme[]): ThemeChoice[] {
  const sorted = [...themes].sort((a, b) => a.label.localeCompare(b.label));
  return [...BUILTIN_CHOICES, ...sorted.filter((t) => t.kind === "light").map(choiceOf), ...sorted.filter((t) => t.kind === "dark").map(choiceOf)];
}

/** The choice currently in effect (a missing/uninstalled extension theme falls back to the built-in pref). */
export function currentChoiceId(colorTheme: string, pref: string, themes: PluginTheme[]): string {
  if (colorTheme && themes.some((t) => t.id === colorTheme)) return colorTheme;
  return `builtin:${pref || "dark"}`;
}

const resolve = (id: string) =>
  id.startsWith("builtin:") ? { colorTheme: "", themePref: id.slice(8) as ThemePref } : { colorTheme: id, themePref: getSetting<string>("appearance.theme") as ThemePref };

/** Applies (and persists) a theme choice. */
export function applyThemeChoice(id: string) {
  const st = useSettingsStore.getState();
  const r = resolve(id);
  st.set("appearance.colorTheme", r.colorTheme);
  if (id.startsWith("builtin:")) st.set("appearance.theme", r.themePref);
  const label = themeChoices(useWorkbench.getState().themes).find((c) => c.id === id)?.label;
  if (label) useWorkbench.getState().toast("ok", `Color theme: ${label}`, "theme");
}

/** Temporarily shows a choice without saving it (picker live preview). */
function previewThemeChoice(id: string) {
  const r = resolve(id);
  applyAppearance({ ...r, accent: getSetting<string>("appearance.accentColor"), themes: useWorkbench.getState().themes, persist: false });
}

/** Re-applies the saved appearance (after a preview). */
function revertPreview() {
  applyAppearance({
    colorTheme: getSetting<string>("appearance.colorTheme"),
    themePref: getSetting<string>("appearance.theme") as ThemePref,
    accent: getSetting<string>("appearance.accentColor"),
    themes: useWorkbench.getState().themes,
  });
}

export const openThemePicker = () => {
  const s = useWorkbench.getState();
  if (s.paletteOpen) s.setPalette(false);
  s.setThemePicker(true);
};

/** Opens the Extensions view searching "@themes" (Mission: as a page; Code: the sidebar). */
export function browseThemes() {
  const s = useWorkbench.getState();
  s.searchExtensions("@themes");
  openExtensions();
}

// ---------------------------------------------------------------- mini preview

/** A tiny workbench rendering of a theme: title bar, activity bar, sidebar, editor lines, status bar. */
export function ThemePreview({ colors, className = "", split }: { colors: Colors; className?: string; split?: Colors }) {
  const c = (k: string, fb = "#888") => colors[k] ?? fb;
  return (
    <div className={`relative overflow-hidden rounded-md border ${className}`} style={{ background: c("bg-editor"), borderColor: c("border") }} aria-hidden>
      <div className="flex h-full flex-col">
        <div className="h-[12%] min-h-[4px]" style={{ background: c("bg-title") }} />
        <div className="flex min-h-0 flex-1">
          <div className="w-[8%]" style={{ background: c("bg-activity") }} />
          <div className="w-[26%] space-y-[6%] p-[4%]" style={{ background: c("bg-side"), borderRight: `1px solid ${c("border")}` }}>
            <div className="h-[3px] w-4/5 rounded" style={{ background: c("fg-faint") }} />
            <div className="h-[3px] w-3/5 rounded" style={{ background: c("accent") }} />
            <div className="h-[3px] w-2/3 rounded" style={{ background: c("fg-faint") }} />
          </div>
          <div className="min-w-0 flex-1 space-y-[5%] p-[5%]">
            <div className="flex gap-[4%]">
              <div className="h-[3px] w-1/4 rounded" style={{ background: c("accent") }} />
              <div className="h-[3px] w-1/3 rounded" style={{ background: c("fg") }} />
            </div>
            <div className="ml-[10%] flex gap-[4%]">
              <div className="h-[3px] w-1/5 rounded" style={{ background: c("ok") }} />
              <div className="h-[3px] w-2/5 rounded" style={{ background: c("fg-faint") }} />
            </div>
            <div className="ml-[10%] flex gap-[4%]">
              <div className="h-[3px] w-1/3 rounded" style={{ background: c("warn") }} />
              <div className="h-[3px] w-1/5 rounded" style={{ background: c("err") }} />
            </div>
            <div className="h-[3px] w-1/2 rounded" style={{ background: c("fg") }} />
          </div>
        </div>
        <div className="h-[9%] min-h-[3px]" style={{ background: c("status") }} />
      </div>
      {split && (
        <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
          <ThemePreview colors={split} className="!rounded-none !border-0 h-full" />
        </div>
      )}
    </div>
  );
}

/** Four-dot swatch row (sidebar, editor, accent, foreground). */
export function ThemeSwatches({ colors }: { colors: Colors }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-full border border-line" aria-hidden>
      {["bg-side", "bg-editor", "accent", "fg"].map((k) => (
        <span key={k} className="h-3 w-3" style={{ background: colors[k] }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- quick pick

export default function ThemePicker() {
  const open = useWorkbench((s) => s.themePickerOpen);
  if (!open) return null;
  return <PickerDialog />;
}

function PickerDialog() {
  const themes = useWorkbench((s) => s.themes);
  const close = () => useWorkbench.getState().setThemePicker(false);
  const all = useMemo(() => themeChoices(themes), [themes]);
  const startId = useMemo(() => currentChoiceId(getSetting("appearance.colorTheme"), getSetting("appearance.theme"), themes), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? all.filter((c) => `${c.group === "Built-in" ? "built-in: " : ""}${c.label} ${c.group} ${c.kind} ${c.pluginId ?? ""}`.toLowerCase().includes(t)) : all;
  }, [all, q]);
  // Index over items + the trailing "Browse more themes…" row.
  const [idx, setIdx] = useState(() => Math.max(0, all.findIndex((c) => c.id === startId)));
  const list = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const browseIdx = items.length;

  // Live preview of the highlighted entry.
  useEffect(() => {
    const c = items[idx];
    if (c) previewThemeChoice(c.id);
  }, [idx, items]);

  // Closing without choosing (Esc, click outside, unmount) reverts the preview.
  useEffect(
    () => () => {
      if (!done.current) revertPreview();
    },
    [],
  );

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const choose = (i: number) => {
    if (i === browseIdx) {
      close();
      browseThemes();
      return;
    }
    const c = items[i];
    if (!c) return;
    done.current = true;
    applyThemeChoice(c.id);
    close();
  };

  const rows: ({ heading: string } | { c: ThemeChoice; i: number })[] = [];
  items.forEach((c, i) => {
    if (i === 0 || items[i - 1].group !== c.group) rows.push({ heading: c.group });
    rows.push({ c, i });
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/20 pt-[10vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select color theme"
        className="h-fit w-[560px] max-w-[92vw] overflow-hidden rounded-lg border border-line bg-elev shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-line">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="theme-list"
            aria-activedescendant={`theme-opt-${idx}`}
            className="h-10 w-full bg-transparent pl-9 pr-4 text-[13px]"
            style={{ outline: "none" }}
            placeholder="Select Color Theme (↑↓ to preview)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
              else if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(i + 1, browseIdx)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)));
              else if (e.key === "Home") (e.preventDefault(), setIdx(0));
              else if (e.key === "End") (e.preventDefault(), setIdx(browseIdx));
              else if (e.key === "Enter") (e.preventDefault(), choose(idx));
            }}
          />
        </div>
        <div ref={list} id="theme-list" role="listbox" aria-label="Color themes" className="max-h-[56vh] overflow-y-auto py-1">
          {rows.map((r) =>
            "heading" in r ? (
              <div key={`h-${r.heading}`} role="presentation" className="px-4 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                {r.heading}
              </div>
            ) : (
              <div
                key={r.c.id}
                id={`theme-opt-${r.i}`}
                data-idx={r.i}
                role="option"
                aria-selected={r.i === idx}
                onMouseMove={() => r.i !== idx && setIdx(r.i)}
                onClick={() => choose(r.i)}
                className={`flex h-[30px] cursor-pointer items-center gap-3 px-4 ${r.i === idx ? "bg-active" : ""}`}
              >
                <ThemeSwatches colors={r.c.colors} />
                <span className="min-w-0 flex-1 truncate">
                  {r.c.group === "Built-in" ? `Built-in: ${r.c.label}` : r.c.label}
                  {r.c.kind === "system" && <span className="ml-2 text-[11px] text-faint">follows the OS</span>}
                </span>
                {r.c.pluginId && <span className="shrink-0 truncate text-[11px] text-faint">{r.c.pluginId}</span>}
                {r.c.id === startId && <Check size={13} className="shrink-0 text-accent" aria-label="current" />}
              </div>
            ),
          )}
          {!items.length && <div className="px-4 py-2 text-muted">No installed theme matches “{q}”.</div>}
          <div className="mx-3 my-1 border-t border-line" role="presentation" />
          <div
            id={`theme-opt-${browseIdx}`}
            data-idx={browseIdx}
            role="option"
            aria-selected={idx === browseIdx}
            onMouseMove={() => idx !== browseIdx && setIdx(browseIdx)}
            onClick={() => choose(browseIdx)}
            className={`flex h-[30px] cursor-pointer items-center gap-3 px-4 text-accent ${idx === browseIdx ? "bg-active" : ""}`}
          >
            <Palette size={14} /> Browse more themes…
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-1.5 text-[11px] text-faint">
          <span>
            <span className="kbd">↑↓</span> preview
          </span>
          <span>
            <span className="kbd">↵</span> apply
          </span>
          <span className="ml-auto">
            <span className="kbd">esc</span> revert
          </span>
        </div>
      </div>
    </div>
  );
}

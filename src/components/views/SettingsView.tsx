"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson, Keyboard, RotateCcw, Search, Settings, X } from "lucide-react";
import { useWorkbench } from "@/store/workbench";
import { useSettingsStore } from "@/store/settings";
import { SETTING_CATEGORIES, SETTINGS, validateSetting, type SettingCategory, type SettingDef, type SettingValue } from "@/lib/userSettings";
import { confirmDialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { AgentsCard, DepartmentsCard, RegistriesCard } from "@/components/settings/AgentSettings";
import { openSettingsJson, openShortcuts } from "@/components/workbench/actions";
import { shortcut } from "@/components/workbench/shortcuts";
import { BUILTIN_CHOICES, ThemePreview, applyThemeChoice, browseThemes, choiceOf, currentChoiceId, openThemePicker } from "@/components/workbench/ThemePicker";
import { Palette, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";

/** Scroll-anchor id of a settings category section (Appearance keeps the historical `settings-appearance`). */
export const categoryAnchor = (c: SettingCategory) => (c === "Appearance" ? "settings-appearance" : `settings-cat-${c.toLowerCase()}`);

/** Non-schema sections rendered after (or inside) the categories. */
const SPECIAL = {
  agents: { id: "settings-agents", label: "Agents", keywords: "agents claude codex cli install login default model" },
  departments: { id: "settings-departments", label: "Departments", keywords: "departments agent per department ceo engineering marketing" },
  registries: { id: "settings-registries", label: "Extension marketplaces", keywords: "extension marketplace registry registries plugins" },
  shortcuts: { id: "settings-shortcuts", label: "Keyboard Shortcuts", keywords: "keyboard shortcuts keybindings" },
} as const;

/** Table of contents shared with the Settings side bar. */
export const SETTINGS_TOC: { id: string; label: string }[] = [
  ...SETTING_CATEGORIES.filter((c) => c !== "Features").map((c) => ({ id: categoryAnchor(c), label: c })),
  { id: SPECIAL.departments.id, label: SPECIAL.departments.label },
  { id: categoryAnchor("Features"), label: "Features" },
  { id: SPECIAL.registries.id, label: SPECIAL.registries.label },
  { id: SPECIAL.shortcuts.id, label: SPECIAL.shortcuts.label },
];

/** Schema titles are Title Case ("Side Bar Location"); the UI shows sentence case ("Side bar location"). Acronyms (UI, JSON) stay. */
export function sentenceCase(t: string): string {
  return t
    .split(" ")
    .map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

function matches(def: SettingDef, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${def.key} ${def.category} ${def.title} ${def.description} ${def.type === "enum" ? (def.labels ?? def.options).join(" ") : ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export default function SettingsView() {
  const values = useSettingsStore((s) => s.values);
  const resetAll = useSettingsStore((s) => s.resetAll);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string>(SETTINGS_TOC[0].id);
  const scroller = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const modifiedCount = Object.keys(values).length;
  const raw = query.trim().toLowerCase();
  const onlyModified = /(^|\s)@modified(\s|$)/.test(raw);
  const terms = raw
    .replace(/(^|\s)@modified(?=\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const searching = !!raw;

  const visible = useMemo(() => SETTINGS.filter((d) => matches(d, terms) && (!onlyModified || d.key in values)), [terms.join(" "), onlyModified, values]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCategory = useMemo(() => {
    const m = new Map<SettingCategory, SettingDef[]>();
    for (const d of visible) m.set(d.category, [...(m.get(d.category) ?? []), d]);
    return m;
  }, [visible]);
  const specialVisible = (k: keyof typeof SPECIAL) => !onlyModified && (!terms.length || terms.every((t) => `${SPECIAL[k].label} ${SPECIAL[k].keywords}`.toLowerCase().includes(t)));

  // ⌘F inside the settings editor focuses search (like VS Code).
  useEffect(() => {
    const el = scroller.current?.parentElement;
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    el?.addEventListener("keydown", on);
    return () => el?.removeEventListener("keydown", on);
  }, []);

  // Highlight the TOC entry of the section at the top of the viewport.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const on = () => {
      const top = sc.getBoundingClientRect().top + 24;
      let id = SETTINGS_TOC[0].id;
      for (const t of SETTINGS_TOC) {
        const el = document.getElementById(t.id);
        if (el && el.getBoundingClientRect().top <= top) id = t.id;
      }
      setCurrent(id);
    };
    sc.addEventListener("scroll", on, { passive: true });
    return () => sc.removeEventListener("scroll", on);
  }, []);

  const goto = (id: string) => {
    setQuery("");
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    setCurrent(id);
  };

  const categorySection = (c: SettingCategory, extra?: React.ReactNode) => {
    const defs = byCategory.get(c) ?? [];
    if (!defs.length && !extra) return null;
    return (
      <section key={c} id={categoryAnchor(c)} className="scroll-mt-2" aria-labelledby={`${categoryAnchor(c)}-h`}>
        <h2 id={`${categoryAnchor(c)}-h`} className="section-h mb-1 mt-8 border-b border-line pb-2 first:mt-0">
          {c}
        </h2>
        {defs.map((d) => (
          <SettingRow key={d.key} def={d} />
        ))}
        {extra}
      </section>
    );
  };

  return (
    <div className="@container flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 @[760px]:px-4" role="toolbar" aria-label="Settings">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="input !pl-8 !pr-24"
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searching && (
              <span className="text-[11px] tabular-nums text-faint" aria-live="polite">
                {visible.length} {visible.length === 1 ? "setting" : "settings"}
              </span>
            )}
            {query && (
              <button className="icon-btn !h-5 !w-5" aria-label="Clear search" title="Clear search (Esc)" onClick={() => setQuery("")}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <button
          className={`btn btn-sm shrink-0 ${onlyModified ? "!border-accent !bg-active !text-fg" : ""}`}
          aria-pressed={onlyModified}
          title="Show only settings you changed (@modified)"
          onClick={() => setQuery(onlyModified ? raw.replace(/(^|\s)@modified(?=\s|$)/g, "").trim() : `@modified ${query}`.trim())}
        >
          Modified
          <span className="count">{modifiedCount}</span>
        </button>
        <button className="icon-btn icon-btn-lg shrink-0" title="Open settings.json" aria-label="Open settings.json" onClick={openSettingsJson}>
          <FileJson size={15} />
        </button>
        <button
          className="btn btn-ghost btn-sm shrink-0"
          disabled={!modifiedCount}
          title={modifiedCount ? "Reset every changed setting to its default" : "No settings changed"}
          onClick={() =>
            void confirmDialog({ title: "Reset all settings?", message: `${modifiedCount} changed setting${modifiedCount === 1 ? "" : "s"} will return to the default.`, confirmLabel: "Reset all", danger: true }).then((ok) => ok && resetAll())
          }
        >
          <RotateCcw size={13} /> <span className="hidden @[560px]:inline">Reset all…</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="hidden w-48 shrink-0 overflow-y-auto border-r border-line bg-side py-2 @[760px]:block">
          {SETTINGS_TOC.map((t) => {
            const label = sentenceCase(t.label);
            const on = !searching && current === t.id;
            return (
              <button key={t.id} className={`row w-full !px-4 text-left ${on ? "font-medium" : "text-muted hover:text-fg"}`} aria-current={on ? "true" : undefined} onClick={() => goto(t.id)} title={label}>
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-4xl px-4 pb-24 pt-4 @[760px]:px-8">
            {categorySection("Workbench")}
            {categorySection("Appearance")}
            {categorySection("Editor")}
            {categorySection("Files")}
            {categorySection("Terminal")}
            {categorySection(
              "Agents",
              specialVisible("agents") ? (
                <div className="mt-3">
                  <AgentsCard />
                </div>
              ) : undefined,
            )}
            {specialVisible("departments") && (
              <div className="mt-6">
                <DepartmentsCard />
              </div>
            )}
            {categorySection("Features")}
            {specialVisible("registries") && (
              <div className="mt-6">
                <RegistriesCard />
              </div>
            )}
            {specialVisible("shortcuts") && <ShortcutsSection />}
            {searching && !visible.length && !Object.keys(SPECIAL).some((k) => specialVisible(k as keyof typeof SPECIAL)) && (
              <EmptyState icon={Search} title={onlyModified && !terms.length ? "No changed settings" : "No settings found"} hint={onlyModified ? "Only settings you changed are shown. Turn off Modified to see all." : "Try a different word, or a setting ID like editor.fontSize."} secondary={{ label: "Clear search", onClick: () => setQuery("") }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rows

function SettingRow({ def }: { def: SettingDef }) {
  const modified = useSettingsStore((s) => def.key in s.values);
  const value = useSettingsStore((s) => (s.values[def.key] ?? def.default) as SettingValue);
  const set = useSettingsStore((s) => s.set);
  const reset = useSettingsStore((s) => s.reset);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const controlId = `setting-${def.key}`;
  const [group, ...rest] = def.title.includes(": ") ? def.title.split(": ") : [null, def.title];
  const title = sentenceCase(rest.join(": "));

  return (
    <div
      id={controlId + "-row"}
      data-setting={def.key}
      data-modified={modified || undefined}
      className="group relative -mx-3 rounded px-3 py-3 hover:bg-hover/40 focus-within:bg-hover/40"
    >
      {modified && <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded bg-accent" aria-hidden />}
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <span className="text-muted">
              {def.category}
              {group ? ` › ${sentenceCase(group)}` : ""}:{" "}
            </span>
            <label htmlFor={def.type === "boolean" || def.type === "color" ? undefined : controlId} className="font-semibold">
              {title}
            </label>
            {modified && <span className="ml-2 text-[11px] text-faint">Modified</span>}
          </div>
          {def.type !== "boolean" && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{def.description}</div>}
        </div>
        <button
          className={`icon-btn !h-6 !w-6 shrink-0 ${modified ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}`}
          title="More actions"
          aria-label={`More actions for ${def.key}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 2 });
          }}
        >
          <Settings size={13} />
        </button>
      </div>
      <div className="mt-1.5">
        {def.key === "appearance.colorTheme" ? <ThemeGallery /> : <Control def={def} value={value} id={controlId} onChange={(v) => set(def.key, v)} />}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Setting actions"
          onClose={() => setMenu(null)}
          items={[
            { label: "Reset setting", icon: RotateCcw, disabled: !modified, onSelect: () => reset(def.key) },
            { type: "separator" },
            { label: "Copy setting ID", onSelect: () => void navigator.clipboard?.writeText(def.key) },
            { label: "Copy setting as JSON", onSelect: () => void navigator.clipboard?.writeText(`"${def.key}": ${JSON.stringify(value)}`) },
          ]}
        />
      )}
    </div>
  );
}

/** Settings → Appearance: built-in + installed extension themes as mini previews. */
function ThemeGallery() {
  const themes = useWorkbench((s) => s.themes);
  const colorTheme = useSettingsStore((s) => (s.values["appearance.colorTheme"] as string | undefined) ?? "");
  const pref = useSettingsStore((s) => (s.values["appearance.theme"] as string | undefined) ?? "dark");
  const current = currentChoiceId(colorTheme, pref, themes);
  const choices = [...BUILTIN_CHOICES, ...[...themes].sort((a, b) => a.label.localeCompare(b.label)).map(choiceOf)];
  const light = BUILTIN_CHOICES[1].colors;
  return (
    <div>
      <div role="radiogroup" aria-label="Color theme" className="grid grid-cols-2 gap-2.5 @[560px]:grid-cols-3 @[880px]:grid-cols-4">
        {choices.map((c) => {
          const on = c.id === current;
          return (
            <button
              key={c.id}
              role="radio"
              aria-checked={on}
              className={`group/theme rounded-[6px] border p-1.5 text-left transition-colors ${on ? "border-accent bg-active/40" : "border-line hover:border-fg/40"}`}
              onClick={() => applyThemeChoice(c.id)}
            >
              <ThemePreview colors={c.colors} split={c.kind === "system" ? light : undefined} className="h-16 w-full" />
              <span className="mt-1.5 flex items-center gap-1 px-0.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                <span className="shrink-0 text-[11px] text-faint">{c.group === "Built-in" ? "Built-in" : c.kind === "light" ? "Light" : "Dark"}</span>
              </span>
            </button>
          );
        })}
        <button className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed border-line p-1.5 text-[12px] text-muted hover:border-fg/40 hover:text-fg" onClick={browseThemes}>
          <Plus size={16} /> Get more themes
        </button>
      </div>
      <button className="btn btn-sm mt-2.5" onClick={openThemePicker}>
        <Palette size={13} /> Open theme picker <span className="kbd">{shortcut("colorTheme")}</span>
      </button>
    </div>
  );
}

function Control({ def, value, id, onChange }: { def: SettingDef; value: SettingValue; id: string; onChange: (v: unknown) => void }) {
  switch (def.type) {
    case "boolean":
      return (
        <label className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
          <input id={id} type="checkbox" className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} />
          <span>{def.description}</span>
        </label>
      );
    case "enum":
      return (
        <select id={id} className="input !w-auto min-w-[200px] max-w-full" value={value as string} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o, i) => (
            <option key={o} value={o}>
              {def.labels?.[i] ?? o}
            </option>
          ))}
        </select>
      );
    case "number":
      return <NumberInput id={id} def={def} value={value as number} onChange={onChange} />;
    case "string":
      return <TextInput id={id} value={value as string} placeholder={def.placeholder ?? String(def.default)} onChange={onChange} />;
    case "color":
      return (
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={def.title}>
          <button
            role="radio"
            aria-checked={!value}
            title="Theme default"
            className={`flex h-6 items-center rounded border px-2 text-[11.5px] ${!value ? "border-fg" : "border-line text-muted hover:text-fg"}`}
            onClick={() => onChange("")}
          >
            Default
          </button>
          {def.swatches.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-checked={value === s.value}
              aria-label={s.label}
              title={s.label}
              className={`h-6 w-6 rounded-full border-2 ${value === s.value ? "border-fg" : "border-transparent hover:border-line"}`}
              style={{ background: s.value }}
              onClick={() => onChange(s.value)}
            />
          ))}
          <label className="ml-1 flex items-center gap-1.5 text-[11.5px] text-muted" title="Custom color">
            <input type="color" className="h-6 w-8 rounded border border-line bg-transparent" value={(value as string) || "#3574f0"} onChange={(e) => onChange(e.target.value)} aria-label="Custom accent color" />
            Custom
          </label>
        </div>
      );
  }
}

function NumberInput({ id, def, value, onChange }: { id: string; def: Extract<SettingDef, { type: "number" }>; value: number; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const invalid = validateSetting(def.key, text) === undefined || (def.min !== undefined && Number(text) < def.min) || (def.max !== undefined && Number(text) > def.max);
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={`input !w-40 ${invalid ? "!border-err" : ""}`}
        min={def.min}
        max={def.max}
        step={def.step}
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max)) onChange(n);
        }}
        onBlur={() => setText(String(value))}
      />
      {(def.min !== undefined || def.max !== undefined) && (
        <span className="text-[11px] text-faint">
          {def.min ?? "−∞"} – {def.max ?? "∞"}
        </span>
      )}
    </div>
  );
}

function TextInput({ id, value, placeholder, onChange }: { id: string; value: string; placeholder: string; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      id={id}
      className="input max-w-md font-mono !text-[12px]"
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsSection() {
  const rows: [string, string][] = [
    ["Command palette", shortcut("palette")],
    ["Go to file", shortcut("quickOpen")],
    ["Open settings", shortcut("settings")],
    ["Toggle agent panel", shortcut("agent")],
    ["Open terminal", shortcut("terminal")],
  ];
  return (
    <section id={SPECIAL.shortcuts.id} className="mt-8 scroll-mt-2 space-y-3" aria-labelledby={`${SPECIAL.shortcuts.id}-h`}>
      <h2 id={`${SPECIAL.shortcuts.id}-h`} className="section-h border-b border-line pb-2">
        Keyboard shortcuts
      </h2>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {rows.map(([l, k]) => (
          <span key={l}>
            <span className="kbd">{k}</span> {l}
          </span>
        ))}
      </div>
      <button className="btn btn-sm" onClick={openShortcuts}>
        <Keyboard size={13} /> Show all shortcuts
      </button>
    </section>
  );
}

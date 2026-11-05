/**
 * Theme preference: "dark" | "light" | "system", stored in localStorage `rex-theme`.
 * The resolved theme lives on <html data-theme>. layout.tsx applies it before first
 * paint with an inline script; this module keeps it in sync at runtime.
 */
export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "rex-theme";
const EVENT = "rex-theme-change";

export function getThemePref(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* storage blocked */
  }
  return "dark";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

export function getResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Applies a preference without persisting it. A contributed color theme in effect
 * (data-color-theme-kind, see colorTheme.ts) decides dark/light instead of the pref.
 */
export function applyThemePref(pref: ThemePref) {
  apply(pref);
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  const kind = root.dataset.colorThemeKind;
  root.dataset.theme = kind === "light" || kind === "dark" ? kind : resolveTheme(pref);
  root.dataset.themePref = pref;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { pref, theme: root.dataset.theme } }));
}

/** Sets and persists the theme preference. */
export function setTheme(t: ThemePref): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked */
  }
  apply(t);
}

/** Cycles dark → light → system (palette "Toggle theme"). */
export function cycleTheme(): ThemePref {
  const order: ThemePref[] = ["dark", "light", "system"];
  const next = order[(order.indexOf(getThemePref()) + 1) % order.length];
  setTheme(next);
  return next;
}

/** Subscribes to theme changes (explicit or OS-level when on "system"). Returns unsubscribe. */
export function onThemeChange(cb: (theme: ResolvedTheme, pref: ThemePref) => void): () => void {
  const handler = () => cb(getResolvedTheme(), getThemePref());
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Follows OS changes while the preference is "system". Call once on mount. */
export function initTheme(): () => void {
  apply(getThemePref());
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  const onChange = () => getThemePref() === "system" && apply("system");
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

/**
 * Inline, dependency-free script for layout.tsx (runs before first paint): the built-in
 * pref, then any contributed color theme cached in `rex-theme-vars` by colorTheme.ts.
 */
export const THEME_BOOT_SCRIPT = `try{var d=document.documentElement;var p=localStorage.getItem('${KEY}')||'dark';var t=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):(p==='light'?'light':'dark');d.dataset.themePref=p;var c=JSON.parse(localStorage.getItem('rex-theme-vars')||'null');if(c&&c.vars){for(var k in c.vars)if(/^--[a-z-]+$/.test(k))d.style.setProperty(k,String(c.vars[k]));if(c.id&&(c.kind==='light'||c.kind==='dark')){t=c.kind;d.dataset.colorTheme=c.id;d.dataset.colorThemeKind=c.kind}}d.dataset.theme=t}catch(e){}`;

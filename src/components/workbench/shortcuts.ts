import { isMacPlatform } from "@/lib/userSettings";

/**
 * Single source of truth for workbench keyboard shortcuts: the global key handler
 * (Workbench), tooltips, command-palette hints and the "Keyboard Shortcuts" tab.
 * Keys are written mac-style ("⌘⇧P"); `kbd()` renders them for the current platform.
 */
export interface ShortcutDef {
  id: string;
  keys: string;
  /** Alternative binding, shown after the primary. */
  alt?: string;
  label: string;
  group: "General" | "Navigation" | "Layout" | "Editor" | "Terminal" | "Help";
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: "palette", keys: "⌘K", alt: "⌘⇧P", label: "Command palette", group: "General" },
  { id: "quickOpen", keys: "⌘P", label: "Go to file…", group: "General" },
  { id: "newProject", keys: "⌘N", alt: "⌥⌘N", label: "New project…", group: "General" },
  { id: "settings", keys: "⌘,", label: "Open settings", group: "General" },
  { id: "colorTheme", keys: "⌘K ⌘T", label: "Color theme…", group: "General" },
  { id: "search", keys: "⌘⇧F", label: "Search in files", group: "Navigation" },
  { id: "scm", keys: "⌘⇧G", label: "Source control", group: "Navigation" },
  { id: "extensions", keys: "⌘⇧X", label: "Extensions", group: "Navigation" },
  { id: "explorer", keys: "⌘⇧E", label: "Explorer", group: "Navigation" },
  { id: "runs", keys: "⌥⌘R", label: "Agent runs", group: "Navigation" },
  { id: "focusSidebar", keys: "⌘1", label: "Focus sidebar", group: "Navigation" },
  { id: "focusEditor", keys: "⌘2", label: "Focus editor", group: "Navigation" },
  { id: "focusAgent", keys: "⌘3", label: "Focus agent panel", group: "Navigation" },
  { id: "sidebar", keys: "⌘B", label: "Toggle sidebar", group: "Layout" },
  { id: "agent", keys: "⌘L", alt: "⌘⇧I", label: "Toggle agent panel", group: "Layout" },
  { id: "panel", keys: "⌘J", label: "Toggle bottom panel", group: "Layout" },
  { id: "layoutMode", keys: "⌘⇧M", label: "Toggle Mission / Code mode", group: "Layout" },
  { id: "closeTab", keys: "⌘W", alt: "⌃W", label: "Close active tab", group: "Editor" },
  { id: "nextTab", keys: "⌃Tab", alt: "⌥⌘→", label: "Next tab", group: "Editor" },
  { id: "prevTab", keys: "⌃⇧Tab", alt: "⌥⌘←", label: "Previous tab", group: "Editor" },
  { id: "save", keys: "⌘S", label: "Save file", group: "Editor" },
  { id: "saveAll", keys: "⌥⌘S", label: "Save all files", group: "Editor" },
  { id: "zoomIn", keys: "⌘=", label: "Zoom in", group: "Layout" },
  { id: "zoomOut", keys: "⌘-", label: "Zoom out", group: "Layout" },
  { id: "zoomReset", keys: "⌘0", label: "Reset zoom", group: "Layout" },
  { id: "terminal", keys: "⌃`", label: "Open terminal", group: "Terminal" },
  { id: "welcome", keys: "", label: "Welcome / Get started", group: "Help" },
  { id: "shortcuts", keys: "", label: "Keyboard shortcuts", group: "Help" },
];

/** macOS detection (navigator.userAgentData / navigator.platform; `?platform=win|mac` overrides for testing). */
export const isMac = () => isMacPlatform();

/** Renders "⌘⇧P" as "Ctrl+Shift+P" off macOS. */
export function kbd(keys: string): string {
  if (!keys || isMac()) return keys;
  // Windows/Linux convention: Ctrl+Shift+Alt+Key regardless of the mac glyph order.
  return keys
    .split(" ")
    .map((chord) => {
      const mods = [/[⌘⌃]/.test(chord) && "Ctrl", chord.includes("⇧") && "Shift", chord.includes("⌥") && "Alt"].filter(Boolean);
      const key = chord.replace(/[⌘⌃⇧⌥]/g, "").replace(/←/g, "Left").replace(/→/g, "Right").replace(/↑/g, "Up").replace(/↓/g, "Down");
      return [...mods, key].join("+");
    })
    .join(" ");
}

export function shortcut(id: string): string {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? kbd(s.keys) : "";
}

/** "Toggle sidebar (⌘B)" — tooltip text including the shortcut, when there is one. */
export function withShortcut(label: string, id: string): string {
  const k = shortcut(id);
  return k ? `${label} (${k})` : label;
}

/** True when the key event originates in a text field, Monaco, or xterm. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.isContentEditable) return true;
  if (el.closest(".monaco-editor, .xterm")) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export const inTerminal = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.(".xterm");

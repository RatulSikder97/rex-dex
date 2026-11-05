/**
 * User settings schema registry (client-safe, no React).
 * Values are stored in the `rex-settings` zustand store (src/store/settings.ts);
 * only user-overridden values are persisted, everything else falls back to `default`.
 */

export type SettingCategory = "Workbench" | "Appearance" | "Editor" | "Files" | "Terminal" | "Agents" | "Features";

export const SETTING_CATEGORIES: SettingCategory[] = ["Workbench", "Appearance", "Editor", "Files", "Terminal", "Agents", "Features"];

interface Base<T> {
  key: string;
  title: string;
  description: string;
  category: SettingCategory;
  default: T;
}
export type BooleanSetting = Base<boolean> & { type: "boolean" };
export type NumberSetting = Base<number> & { type: "number"; min?: number; max?: number; step?: number };
export type StringSetting = Base<string> & { type: "string"; placeholder?: string };
export type EnumSetting = Base<string> & { type: "enum"; options: string[]; labels?: string[] };
export type ColorSetting = Base<string> & { type: "color"; swatches: { value: string; label: string }[] };
export type SettingDef = BooleanSetting | NumberSetting | StringSetting | EnumSetting | ColorSetting;
export type SettingValue = boolean | number | string;

export const ACCENT_SWATCHES = [
  { value: "#0078d4", label: "Blue" },
  { value: "#7c5cff", label: "Violet" },
  { value: "#16a34a", label: "Green" },
  { value: "#d97706", label: "Amber" },
  { value: "#e11d48", label: "Rose" },
  { value: "#0d9488", label: "Teal" },
  { value: "#db2777", label: "Pink" },
];

export const SETTINGS: SettingDef[] = [
  // ---- Workbench
  {
    key: "workbench.startupView",
    title: "Startup View",
    description: "Which editor to show when REX starts.",
    category: "Workbench",
    type: "enum",
    options: ["welcome", "dashboard", "lastSession"],
    labels: ["Welcome page", "Dashboard", "Restore last session"],
    default: "lastSession",
  },
  {
    key: "workbench.sideBarLocation",
    title: "Side Bar Location",
    description: "Controls the location of the primary side bar and activity bar.",
    category: "Workbench",
    type: "enum",
    options: ["left", "right"],
    labels: ["Left", "Right"],
    default: "left",
  },
  {
    key: "workbench.zoomLevel",
    title: "Zoom Level",
    description: "Zoom of the whole UI. 0 is 100%; each step is 10%.",
    category: "Workbench",
    type: "number",
    min: -5,
    max: 8,
    step: 1,
    default: 0,
  },
  {
    key: "workbench.tabCloseButton",
    title: "Tab Close Button",
    description: "Controls whether editor tabs show a close button.",
    category: "Workbench",
    type: "enum",
    options: ["always", "hover", "off"],
    labels: ["Always", "On hover", "Off"],
    default: "hover",
  },
  {
    key: "workbench.confirmBeforeCloseDirty",
    title: "Confirm Before Closing Unsaved Tabs",
    description: "Ask for confirmation before closing an editor tab with unsaved changes.",
    category: "Workbench",
    type: "boolean",
    default: true,
  },
  {
    key: "workbench.statusBar.visible",
    title: "Status Bar: Visible",
    description: "Controls the visibility of the status bar at the bottom of the workbench.",
    category: "Workbench",
    type: "boolean",
    default: true,
  },
  {
    key: "workbench.activityBar.visible",
    title: "Activity Bar: Visible",
    description: "Controls the visibility of the activity bar.",
    category: "Workbench",
    type: "boolean",
    default: true,
  },
  {
    key: "workbench.reduceMotion",
    title: "Reduce Motion",
    description: "Disable animations and transitions in the workbench.",
    category: "Workbench",
    type: "boolean",
    default: false,
  },
  // ---- Appearance
  {
    key: "appearance.theme",
    title: "Color Theme",
    description: "Dark, light, or follow the operating system.",
    category: "Appearance",
    type: "enum",
    options: ["dark", "light", "system"],
    labels: ["Dark", "Light", "System"],
    default: "dark",
  },
  {
    key: "appearance.colorTheme",
    title: "Color Theme: Gallery",
    description: "Built-in themes plus color themes from installed extensions. The stored value is the extension theme id (e.g. \"nord\"); empty uses the built-in Dark / Light / System theme.",
    category: "Appearance",
    type: "string",
    placeholder: "built-in",
    default: "",
  },
  {
    key: "appearance.accentColor",
    title: "Accent Color",
    description: "Color used for focus rings, active indicators and primary buttons.",
    category: "Appearance",
    type: "color",
    swatches: ACCENT_SWATCHES,
    default: "",
  },
  {
    key: "appearance.uiFontSize",
    title: "UI Font Size",
    description: "Base font size (px) of the workbench chrome.",
    category: "Appearance",
    type: "number",
    min: 10,
    max: 20,
    step: 0.5,
    default: 13,
  },
  {
    key: "appearance.density",
    title: "Density",
    description: "Spacing of lists, tabs and toolbars.",
    category: "Appearance",
    type: "enum",
    options: ["compact", "comfortable"],
    labels: ["Compact", "Comfortable"],
    default: "compact",
  },
  // ---- Editor
  { key: "editor.fontSize", title: "Font Size", description: "Controls the font size in pixels.", category: "Editor", type: "number", min: 6, max: 40, step: 1, default: 13 },
  {
    key: "editor.fontFamily",
    title: "Font Family",
    description: "Controls the font family.",
    category: "Editor",
    type: "string",
    default: "JetBrains Mono, SF Mono, Menlo, monospace",
  },
  { key: "editor.tabSize", title: "Tab Size", description: "The number of spaces a tab is equal to.", category: "Editor", type: "number", min: 1, max: 16, step: 1, default: 2 },
  { key: "editor.insertSpaces", title: "Insert Spaces", description: "Insert spaces when pressing Tab.", category: "Editor", type: "boolean", default: true },
  {
    key: "editor.wordWrap",
    title: "Word Wrap",
    description: "Controls how lines should wrap.",
    category: "Editor",
    type: "enum",
    options: ["off", "on", "bounded"],
    labels: ["Off", "On", "Bounded"],
    default: "off",
  },
  { key: "editor.minimap", title: "Minimap: Enabled", description: "Controls whether the minimap is shown.", category: "Editor", type: "boolean", default: true },
  {
    key: "editor.lineNumbers",
    title: "Line Numbers",
    description: "Controls the display of line numbers.",
    category: "Editor",
    type: "enum",
    options: ["on", "off", "relative"],
    labels: ["On", "Off", "Relative"],
    default: "on",
  },
  {
    key: "editor.renderWhitespace",
    title: "Render Whitespace",
    description: "Controls how the editor should render whitespace characters.",
    category: "Editor",
    type: "enum",
    options: ["none", "boundary", "selection", "trailing", "all"],
    labels: ["None", "Boundary", "Selection", "Trailing", "All"],
    default: "selection",
  },
  // ---- Files
  {
    key: "files.autoSave",
    title: "Auto Save",
    description: "Controls auto save of editors that have unsaved changes.",
    category: "Files",
    type: "enum",
    options: ["off", "afterDelay", "onFocusChange"],
    labels: ["Off", "After delay", "On focus change"],
    default: "off",
  },
  {
    key: "files.autoSaveDelay",
    title: "Auto Save Delay",
    description: "Delay in milliseconds after which an editor is saved when Auto Save is 'After delay'.",
    category: "Files",
    type: "number",
    min: 100,
    max: 60000,
    step: 100,
    default: 1000,
  },
  // ---- Terminal (consumed by TerminalPanel)
  { key: "terminal.fontSize", title: "Font Size", description: "Font size of the integrated terminal (px).", category: "Terminal", type: "number", min: 6, max: 32, step: 0.5, default: 12.5 },
  {
    key: "terminal.fontFamily",
    title: "Font Family",
    description: "Font family of the integrated terminal.",
    category: "Terminal",
    type: "string",
    default: "JetBrains Mono, SF Mono, Menlo, monospace",
  },
  { key: "terminal.lineHeight", title: "Line Height", description: "Line height multiplier of the terminal.", category: "Terminal", type: "number", min: 1, max: 2, step: 0.05, default: 1.15 },
  {
    key: "terminal.cursorStyle",
    title: "Cursor Style",
    description: "Controls the style of the terminal cursor.",
    category: "Terminal",
    type: "enum",
    options: ["block", "bar", "underline"],
    labels: ["Block", "Bar", "Underline"],
    default: "block",
  },
  { key: "terminal.cursorBlink", title: "Cursor Blinking", description: "Controls whether the terminal cursor blinks.", category: "Terminal", type: "boolean", default: true },
  { key: "terminal.scrollback", title: "Scrollback", description: "Maximum number of lines the terminal keeps in its buffer.", category: "Terminal", type: "number", min: 100, max: 100000, step: 100, default: 5000 },
  // ---- Agents (consumed by AgentPanel)
  {
    key: "agent.sendKey",
    title: "Send Message Key",
    description: "Which key sends a message in the agent panel. The other inserts a newline.",
    category: "Agents",
    type: "enum",
    options: ["cmdEnter", "enter"],
    labels: ["⌘/Ctrl + Enter", "Enter"],
    default: "cmdEnter",
  },
  {
    key: "agent.defaultMode",
    title: "Default Mode",
    description: "Whether the agent panel starts in chat mode or opens the agent in a terminal.",
    category: "Agents",
    type: "enum",
    options: ["chat", "terminal"],
    labels: ["Chat", "Terminal"],
    default: "chat",
  },
  { key: "agent.showToolCalls", title: "Show Tool Calls", description: "Show the agent's tool calls inline in the conversation.", category: "Agents", type: "boolean", default: true },
  // ---- Features
  { key: "notifications.toasts", title: "Notifications: Toasts", description: "Show toast notifications. Notifications are still collected in the status bar bell.", category: "Features", type: "boolean", default: true },
];

export const SETTINGS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

/** Returns the coerced value if valid for the schema, otherwise `undefined`. */
export function validateSetting(key: string, value: unknown): SettingValue | undefined {
  const def = SETTINGS_BY_KEY[key];
  if (!def) return undefined;
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      if (!Number.isFinite(n)) return undefined;
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
    }
    case "enum":
      return typeof value === "string" && def.options.includes(value) ? value : undefined;
    case "color":
      return typeof value === "string" && (value === "" || /^#[0-9a-f]{3,8}$/i.test(value)) ? value : undefined;
    case "string":
      return typeof value === "string" ? value : undefined;
  }
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const forced = typeof location !== "undefined" ? new URLSearchParams(location.search).get("platform") : null;
  if (forced) return forced.toLowerCase().startsWith("mac");
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad/i.test(p);
}

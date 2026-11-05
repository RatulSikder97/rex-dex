"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { version as reactVersion } from "react";
import { Menu as MenuIcon, X } from "lucide-react";
import pkg from "../../../package.json";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useWorkbench, useDepartments } from "@/store/workbench";
import { useSetting, useSettingsStore } from "@/store/settings";
import { ACTIVITIES } from "./ActivityBar";
import { activeEditor, runEditorAction, subscribeEditors } from "./editorRegistry";
import {
  activate,
  addProjectServer,
  cloneRepositoryFlow,
  closeAll,
  connectRepository,
  newTask,
  openConnections,
  openExtensions,
  openOps,
  openProjectHub,
  openSwarms,
  toggleLayoutMode,
  closeTab,
  cycleTab,
  killTerminal,
  newConversation,
  newFileFlow,
  newProjectFlow,
  newTerminal,
  openFolderFlow,
  openSettingsJson,
  openShortcuts,
  openWelcome,
  recheckAgents,
  resetLayout,
  saveActive,
  saveAll,
  showActivity,
  switchProject,
  togglePanelMaximized,
  zoom,
} from "./actions";
import { inTerminal, isMac, kbd, shortcut } from "./shortcuts";
import { openPaletteWith } from "./CommandPalette";
import { applyThemeChoice, currentChoiceId, openThemePicker } from "./ThemePicker";
import { openLogoStudio } from "@/components/ProjectLogo";
import { desktop, isDesktopMac, type NativeMenu, type NativeMenuItem } from "@/lib/desktop";

interface TopMenu {
  id: string;
  label: string;
  /** Alt+<mnemonic> opens it (Windows/Linux). */
  mnemonic: string;
  items: MenuItem[];
}

/** Editor chords handled by Monaco itself: [macOS, Windows/Linux]. Labels only. */
const EDITOR_KEYS: Record<string, [string, string]> = {
  undo: ["⌘Z", "Ctrl+Z"],
  redo: ["⇧⌘Z", "Ctrl+Y"],
  cut: ["⌘X", "Ctrl+X"],
  copy: ["⌘C", "Ctrl+C"],
  paste: ["⌘V", "Ctrl+V"],
  find: ["⌘F", "Ctrl+F"],
  replace: ["⌥⌘F", "Ctrl+H"],
  comment: ["⌘/", "Ctrl+/"],
  selectAll: ["⌘A", "Ctrl+A"],
  expand: ["⌃⇧⌘→", "Shift+Alt+Right"],
  shrink: ["⌃⇧⌘←", "Shift+Alt+Left"],
  copyUp: ["⌥⇧↑", "Shift+Alt+Up"],
  copyDown: ["⌥⇧↓", "Shift+Alt+Down"],
  moveUp: ["⌥↑", "Alt+Up"],
  moveDown: ["⌥↓", "Alt+Down"],
  cursorAbove: ["⌥⌘↑", "Ctrl+Alt+Up"],
  cursorBelow: ["⌥⌘↓", "Ctrl+Alt+Down"],
  nextMatch: ["⌘D", "Ctrl+D"],
  gotoLine: ["⌃G", "Ctrl+G"],
};
const ek = (id: keyof typeof EDITOR_KEYS) => (isMac() ? EDITOR_KEYS[id][0] : EDITOR_KEYS[id][1]);

/** Undo/Redo/Cut/Copy/Paste outside Monaco: act on the focused text field. */
async function textCommand(cmd: "undo" | "redo" | "cut" | "copy" | "paste") {
  if (cmd !== "paste") {
    document.execCommand(cmd);
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand("insertText", false, text);
  } catch {
    /* clipboard permission denied */
  }
}

function useMenus(): TopMenu[] {
  const mac = isMac();
  const s = useWorkbench();
  const { departments } = useDepartments();
  const theme = useSetting<string>("appearance.theme");
  const colorTheme = useSetting<string>("appearance.colorTheme");
  const activityBar = useSetting<boolean>("workbench.activityBar.visible");
  const statusBar = useSetting<boolean>("workbench.statusBar.visible");
  const sideBarLocation = useSetting<string>("workbench.sideBarLocation");
  const autoSave = useSetting<string>("files.autoSave");
  const wordWrap = useSetting<string>("editor.wordWrap");
  const minimap = useSetting<boolean>("editor.minimap");
  const set = useSettingsStore((x) => x.set);
  const hasEditor = !!useSyncExternalStore(subscribeEditors, activeEditor, () => null);
  const project = s.projects.find((p) => p.id === s.projectId);
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const fileTab = tab?.spec.kind === "file" || tab?.spec.kind === "settingsJson";

  const editorOr = (action: string, fallback?: () => void) => () => {
    if (!runEditorAction(action)) fallback?.();
  };
  const textItem = (label: string, id: "undo" | "redo" | "cut" | "copy" | "paste", monacoAction: string): MenuItem => ({
    label,
    hint: ek(id),
    onSelect: editorOr(monacoAction, () => void textCommand(id)),
  });
  const editorItem = (label: string, id: keyof typeof EDITOR_KEYS, action: string): MenuItem => ({ label, hint: ek(id), disabled: !hasEditor, onSelect: editorOr(action) });

  const themeChoice = currentChoiceId(colorTheme, theme, s.themes);
  const installedThemes = [...s.themes].sort((a, b) => a.label.localeCompare(b.label));
  const themeMenu: MenuItem = {
    type: "submenu",
    label: "Theme",
    items: [
      { label: "Color theme…", hint: shortcut("colorTheme"), onSelect: openThemePicker },
      { type: "separator" },
      ...(["dark", "light", "system"] as const).map<MenuItem>((t) => ({
        label: t === "system" ? "System" : t === "dark" ? "Dark" : "Light",
        checked: themeChoice === `builtin:${t}`,
        onSelect: () => applyThemeChoice(`builtin:${t}`),
      })),
      ...(installedThemes.length
        ? ([{ type: "separator" }, ...installedThemes.map<MenuItem>((t) => ({ label: t.label, checked: themeChoice === t.id, onSelect: () => applyThemeChoice(t.id) }))] as MenuItem[])
        : []),
    ],
  };
  const noProject = !project;
  const prefsItems: MenuItem[] = [
    { label: mac ? "Settings…" : "Settings", hint: shortcut("settings"), onSelect: () => s.openSettings() },
    { label: "Settings (JSON)", onSelect: openSettingsJson },
    { label: "Color theme…", hint: shortcut("colorTheme"), onSelect: openThemePicker },
    { label: "Keyboard shortcuts", onSelect: openShortcuts },
    { label: "Extensions", hint: shortcut("extensions"), onSelect: openExtensions },
    { label: "Connections", onSelect: openConnections },
    { type: "separator" },
    themeMenu,
    { type: "separator" },
    { label: "Manage agents", onSelect: () => s.openSettings("settings-agents") },
    { label: "Check agents…", onSelect: () => void recheckAgents() },
  ];

  const appMenu: TopMenu = {
    id: "app",
    label: "REX",
    mnemonic: "",
    items: [
      { label: "About REX", onSelect: () => window.dispatchEvent(new Event("rex:about")) },
      { type: "separator" },
      { label: "Settings…", hint: shortcut("settings"), onSelect: () => s.openSettings() },
      { label: "Settings (JSON)", onSelect: openSettingsJson },
      { label: "Color theme…", hint: shortcut("colorTheme"), onSelect: openThemePicker },
      themeMenu,
      { type: "separator" },
      { label: "Extensions", hint: shortcut("extensions"), onSelect: openExtensions },
      { label: "Connections", onSelect: openConnections },
      { label: "Keyboard shortcuts", onSelect: openShortcuts },
      { type: "separator" },
      { label: "Manage agents", onSelect: () => s.openSettings("settings-agents") },
      { label: "Check agents…", onSelect: () => void recheckAgents() },
    ],
  };

  const file: TopMenu = {
    id: "file",
    label: "File",
    mnemonic: "f",
    items: [
      { label: "New task", onSelect: newTask },
      { label: "New project…", hint: shortcut("newProject"), onSelect: () => void newProjectFlow() },
      { label: "New file…", disabled: !project?.repo_path, onSelect: () => void newFileFlow() },
      { type: "separator" },
      { label: "Open folder as project…", onSelect: () => void openFolderFlow() },
      {
        type: "submenu",
        label: "Open recent",
        disabled: !s.projects.length,
        items: s.projects.slice(0, 12).map<MenuItem>((p) => ({ label: p.name, checked: p.id === s.projectId, onSelect: () => switchProject(p.id) })),
      },
      { label: "Clone repository…", onSelect: () => void cloneRepositoryFlow() },
      { type: "separator" },
      { label: "Project hub…", disabled: noProject, onSelect: () => openProjectHub() },
      { label: "Connect repository…", disabled: noProject, onSelect: () => connectRepository() },
      { label: "Add server…", disabled: noProject, onSelect: () => addProjectServer() },
      { label: "Generate logo…", disabled: noProject, onSelect: () => openLogoStudio() },
      { type: "separator" },
      { label: "Save", hint: shortcut("save"), disabled: !fileTab, onSelect: saveActive },
      { label: "Save all", hint: shortcut("saveAll"), disabled: !s.tabs.some((t) => t.dirty), onSelect: saveAll },
      { label: "Auto save", checked: autoSave !== "off", onSelect: () => set("files.autoSave", autoSave === "off" ? "afterDelay" : "off") },
      { type: "separator" },
      { type: "submenu", label: "Preferences", items: prefsItems },
      { type: "separator" },
      { label: "Close editor", hint: shortcut("closeTab"), disabled: !tab, onSelect: () => tab && void closeTab(tab.id) },
      { label: "Close all editors", disabled: !s.tabs.length, onSelect: () => void closeAll() },
    ],
  };

  const edit: TopMenu = {
    id: "edit",
    label: "Edit",
    mnemonic: "e",
    items: [
      textItem("Undo", "undo", "undo"),
      textItem("Redo", "redo", "redo"),
      { type: "separator" },
      textItem("Cut", "cut", "editor.action.clipboardCutAction"),
      textItem("Copy", "copy", "editor.action.clipboardCopyAction"),
      textItem("Paste", "paste", "editor.action.clipboardPasteAction"),
      { type: "separator" },
      editorItem("Find", "find", "actions.find"),
      editorItem("Replace", "replace", "editor.action.startFindReplaceAction"),
      { type: "separator" },
      { label: "Find in files", hint: shortcut("search"), onSelect: () => showActivity("search") },
      { type: "separator" },
      editorItem("Toggle line comment", "comment", "editor.action.commentLine"),
    ],
  };

  const selection: TopMenu = {
    id: "selection",
    label: "Selection",
    mnemonic: "s",
    items: [
      { label: "Select all", hint: ek("selectAll"), onSelect: editorOr("editor.action.selectAll", () => document.execCommand("selectAll")) },
      editorItem("Expand selection", "expand", "editor.action.smartSelect.expand"),
      editorItem("Shrink selection", "shrink", "editor.action.smartSelect.shrink"),
      { type: "separator" },
      editorItem("Copy line up", "copyUp", "editor.action.copyLinesUpAction"),
      editorItem("Copy line down", "copyDown", "editor.action.copyLinesDownAction"),
      editorItem("Move line up", "moveUp", "editor.action.moveLinesUpAction"),
      editorItem("Move line down", "moveDown", "editor.action.moveLinesDownAction"),
      { type: "separator" },
      editorItem("Add cursor above", "cursorAbove", "editor.action.insertCursorAbove"),
      editorItem("Add cursor below", "cursorBelow", "editor.action.insertCursorBelow"),
      editorItem("Add next occurrence", "nextMatch", "editor.action.addSelectionToNextFindMatch"),
    ],
  };

  const view: TopMenu = {
    id: "view",
    label: "View",
    mnemonic: "v",
    items: [
      { label: "Command palette…", hint: kbd("⌘⇧P"), onSelect: () => s.setPalette(true, "commands") },
      {
        type: "submenu",
        label: "Open view",
        items: [...ACTIVITIES.map<MenuItem>((a) => ({ label: a.label, hint: a.shortcut ? shortcut(a.shortcut) : undefined, onSelect: () => activate(a.id) })), { label: "Settings", onSelect: () => activate("settings") }],
      },
      { type: "separator" },
      {
        type: "submenu",
        label: "Appearance",
        items: [
          { label: "Primary side bar", checked: s.sidebarOpen, hint: shortcut("sidebar"), onSelect: () => s.toggleSidebar() },
          { label: "Activity bar", checked: activityBar, onSelect: () => set("workbench.activityBar.visible", !activityBar) },
          { label: "Status bar", checked: statusBar, onSelect: () => set("workbench.statusBar.visible", !statusBar) },
          { label: "Panel", checked: s.panelOpen, hint: shortcut("panel"), onSelect: () => s.togglePanel() },
          { label: "Agent panel", checked: s.agentOpen, hint: shortcut("agent"), onSelect: () => s.toggleAgent() },
          { type: "separator" },
          { label: "Maximize panel", checked: s.panelOpen && s.panelMaximized, onSelect: togglePanelMaximized },
          { label: sideBarLocation === "right" ? "Move primary side bar left" : "Move primary side bar right", onSelect: () => set("workbench.sideBarLocation", sideBarLocation === "right" ? "left" : "right") },
          { label: "Reset layout", onSelect: resetLayout },
          { type: "separator" },
          { label: "Zoom in", hint: shortcut("zoomIn"), onSelect: () => zoom(1) },
          { label: "Zoom out", hint: shortcut("zoomOut"), onSelect: () => zoom(-1) },
          { label: "Reset zoom", hint: shortcut("zoomReset"), onSelect: () => zoom(0) },
        ],
      },
      { label: "Color theme…", hint: shortcut("colorTheme"), onSelect: openThemePicker },
      themeMenu,
      { label: s.layoutMode === "mission" ? "Switch to Code mode" : "Switch to Mission mode", hint: shortcut("layoutMode"), onSelect: toggleLayoutMode },
      { type: "separator" },
      { label: "Ops center", onSelect: openOps },
      { label: "Connections", onSelect: openConnections },
      { label: "Swarms", onSelect: openSwarms },
      { type: "separator" },
      { label: "Explorer", hint: shortcut("explorer"), onSelect: () => showActivity("code") },
      { label: "Search", hint: shortcut("search"), onSelect: () => showActivity("search") },
      { label: "Source control", hint: shortcut("scm"), onSelect: () => showActivity("scm") },
      { label: "Agent runs", hint: shortcut("runs"), onSelect: () => showActivity("runs") },
      { label: "Extensions", hint: shortcut("extensions"), onSelect: openExtensions },
      { type: "separator" },
      { label: "Output", onSelect: () => s.setPanelTab("output") },
      { label: "Terminal", hint: shortcut("terminal"), onSelect: () => s.setPanelTab("terminal") },
      { type: "separator" },
      { label: "Word wrap", checked: wordWrap !== "off", onSelect: () => set("editor.wordWrap", wordWrap === "off" ? "on" : "off") },
      { label: "Minimap", checked: minimap, onSelect: () => set("editor.minimap", !minimap) },
    ],
  };

  const go: TopMenu = {
    id: "go",
    label: "Go",
    mnemonic: "g",
    items: [
      { label: "Go to file…", hint: shortcut("quickOpen"), onSelect: () => s.setPalette(true, "files") },
      { label: "Go to tab…", disabled: !s.tabs.length, onSelect: () => openPaletteWith("Go to tab: ") },
      { label: "Go to line…", hint: ek("gotoLine"), disabled: !hasEditor, onSelect: editorOr("editor.action.gotoLine") },
      { type: "separator" },
      { label: "Next tab", hint: shortcut("nextTab"), disabled: s.tabs.length < 2, onSelect: () => cycleTab(1) },
      { label: "Previous tab", hint: shortcut("prevTab"), disabled: s.tabs.length < 2, onSelect: () => cycleTab(-1) },
      { type: "separator" },
      {
        type: "submenu",
        label: "Switch project",
        disabled: !s.projects.length,
        items: s.projects.map<MenuItem>((p) => ({ label: p.name, hint: p.stage, checked: p.id === s.projectId, onSelect: () => switchProject(p.id) })),
      },
      { type: "separator" },
      { label: "Go to project hub", disabled: noProject, onSelect: () => openProjectHub() },
      { label: "Go to Ops", onSelect: openOps },
      { label: "Go to Swarms", onSelect: openSwarms },
      { label: "Command center", onSelect: () => s.openTab({ kind: "dashboard" }, "Command Center") },
    ],
  };

  const agentsInteractive = s.providers.filter((a) => a.interactive && a.available);
  const terminal: TopMenu = {
    id: "terminal",
    label: "Terminal",
    mnemonic: "t",
    items: [
      { label: "New terminal", hint: kbd("⌃⇧`"), onSelect: newTerminal },
      { label: "Toggle terminal", hint: shortcut("terminal"), onSelect: () => (s.panelOpen && s.panelTab === "terminal" ? s.togglePanel(false) : s.setPanelTab("terminal")) },
      { type: "separator" },
      ...(agentsInteractive.length
        ? agentsInteractive.map<MenuItem>((a) => ({ label: `Open ${a.label} in terminal`, onSelect: () => s.launchTerminal({ id: a.id, action: "interactive" }) }))
        : [{ label: "No terminal agents installed", disabled: true, onSelect: () => {} } as MenuItem]),
      { type: "separator" },
      { label: "Kill terminal", onSelect: killTerminal },
    ],
  };

  const agents: TopMenu = {
    id: "agents",
    label: "Agents",
    mnemonic: "a",
    items: [
      { label: "Open agent panel", hint: shortcut("agent"), onSelect: () => s.toggleAgent(true) },
      { label: "New agent task", onSelect: newConversation },
      { type: "separator" },
      ...departments.map<MenuItem>((d) => ({ label: `Ask ${d.name}`, onSelect: () => s.delegate({ department: d.id, brief: "" }) })),
      { type: "separator" },
      { label: "Agent runs", hint: shortcut("runs"), onSelect: () => showActivity("runs") },
      { label: "Manage agents", onSelect: () => s.openSettings("settings-agents") },
      { label: "Check agents…", onSelect: () => void recheckAgents() },
    ],
  };

  const help: TopMenu = {
    id: "help",
    label: "Help",
    mnemonic: "h",
    items: [
      { label: "Welcome", onSelect: openWelcome },
      { label: "Show all commands", hint: kbd("⌘⇧P"), onSelect: () => s.setPalette(true, "commands") },
      { label: "Keyboard shortcuts reference", onSelect: openShortcuts },
      ...(mac ? [] : ([{ type: "separator" }, { label: "About REX", onSelect: () => window.dispatchEvent(new Event("rex:about")) }] as MenuItem[])),
    ],
  };

  return [...(mac ? [appMenu] : []), file, edit, selection, view, go, terminal, agents, help];
}

/** Approximate rendered width of the expanded menu bar (used by the title bar to decide when to collapse). */
export function menuBarWidth(): number {
  if (isDesktopMac()) return 0;
  const labels = [...(isMac() ? ["REX"] : []), "File", "Edit", "Selection", "View", "Go", "Terminal", "Agents", "Help"];
  return labels.reduce((n, l) => n + l.length * 7.2 + 16, 0);
}

/**
 * Application menu. In the macOS desktop app the native menu bar replaces the
 * in-app row (NativeMenuBridge mirrors the same model); everywhere else it's the
 * VS Code-style in-app bar.
 */
export default function MenuBar({ collapsed }: { collapsed: boolean }) {
  if (isDesktopMac()) {
    return (
      <>
        <NativeMenuBridge />
        <DesktopBadge />
        <AboutDialog />
      </>
    );
  }
  return (
    <>
      <DesktopBadge />
      <InAppMenuBar collapsed={collapsed} />
    </>
  );
}

/** Desktop app: dock / taskbar badge = running agent runs. */
function DesktopBadge() {
  const running = useWorkbench((s) => s.runningRuns);
  useEffect(() => desktop()?.setBadge(running), [running]);
  return null;
}

/**
 * Desktop app (macOS): serializes the in-app menu model for the native menu bar
 * (desktop/app/lib/menu.js) and runs the matching action when a native item is
 * clicked (`rex:menu` {id}). Ids are label paths, stable across re-renders.
 */
function NativeMenuBridge() {
  const menus = useMenus();
  const actions = useRef(new Map<string, () => void>());
  const sent = useRef("");

  useEffect(() => {
    const map = new Map<string, () => void>();
    const convert = (items: MenuItem[], prefix: string): NativeMenuItem[] => {
      const seen = new Map<string, number>();
      return items.map((it): NativeMenuItem => {
        if (it.type === "separator") return { type: "separator" };
        if (it.type === "header") return { type: "header", label: it.label };
        const n = seen.get(it.label) ?? 0;
        seen.set(it.label, n + 1);
        const id = `${prefix}>${it.label}${n ? `#${n}` : ""}`;
        if (it.type === "submenu") return { type: "submenu", label: it.label, disabled: it.disabled, items: convert(it.items, id) };
        map.set(id, it.onSelect);
        return { id, label: it.label, hint: it.hint, checked: it.checked, disabled: it.disabled };
      });
    };
    const model: NativeMenu[] = menus.map((m) => ({ id: m.id, label: m.label, items: convert(m.items, m.id) }));
    actions.current = map;
    const json = JSON.stringify(model);
    if (json !== sent.current) {
      sent.current = json;
      desktop()?.setMenu(model);
    }
  });

  useEffect(() => desktop()?.onMenu((id) => actions.current.get(id)?.()), []);
  return null;
}

/**
 * VS Code-style application menu bar. Hover switches between open menus; ←/→ move
 * between menus; Alt / F10 focus the bar and Alt+<letter> opens a menu (Windows/Linux).
 */
function InAppMenuBar({ collapsed }: { collapsed: boolean }) {
  const menus = useMenus();
  const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const mac = isMac();

  const rememberFocus = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && !bar.current?.contains(a) && !a.closest("[data-menu-tree]")) prevFocus.current = a;
  };
  const restoreFocus = useCallback(() => {
    const el = prevFocus.current;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  const buttons = () => Array.from(bar.current?.querySelectorAll<HTMLButtonElement>("[data-menubar-item]") ?? []);
  const focusButton = (i: number) => {
    setFocusIdx(i);
    buttons()[i]?.focus();
  };
  const count = collapsed ? 1 : menus.length;

  const openAt = (index: number, keyboard: boolean) => {
    if (!open) rememberFocus();
    setFocusIdx(index);
    setOpen({ index, keyboard });
  };

  // After a menu closes the pointer usually still rests on its button; don't leave that button looking
  // "stuck" highlighted until the pointer actually moves again.
  const [quiet, setQuiet] = useState(false);
  const pointer = useRef({ x: -1, y: -1 });
  const quietAt = useRef({ x: -1, y: -1 });
  useEffect(() => {
    const track = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", track, true);
    window.addEventListener("pointerdown", track, true);
    return () => {
      window.removeEventListener("pointermove", track, true);
      window.removeEventListener("pointerdown", track, true);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    quietAt.current = { ...pointer.current };
    setQuiet(true);
    restoreFocus();
  }, [restoreFocus]);

  // Alt (tap) / F10 focus the bar; Alt+mnemonic opens a menu. Not on macOS (Option types characters).
  useEffect(() => {
    if (mac) return;
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey;
        return;
      }
      altAlone = false;
      if (e.key === "F10" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        rememberFocus();
        focusButton(0);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[a-z]$/i.test(e.key) && !inTerminal(e.target)) {
        const i = collapsed ? (e.key.toLowerCase() === "f" ? 0 : -1) : menus.findIndex((m) => m.mnemonic === e.key.toLowerCase());
        if (i >= 0) {
          e.preventDefault();
          e.stopPropagation();
          openAt(i, true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      if (inTerminal(e.target)) return;
      e.preventDefault();
      if (bar.current?.contains(document.activeElement)) {
        restoreFocus();
        return;
      }
      rememberFocus();
      focusButton(0);
    };
    const blur = () => (altAlone = false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("mousedown", blur, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("mousedown", blur, true);
    };
  });

  const items: { label: string; items: MenuItem[] }[] = collapsed
    ? [{ label: "Application menu", items: menus.map<MenuItem>((m) => ({ type: "submenu", label: m.label, items: m.items })) }]
    : menus;
  const current = open ? items[open.index] : null;
  const anchor = open ? buttons()[open.index]?.getBoundingClientRect() : null;

  return (
    <div
      ref={bar}
      role="menubar"
      aria-label="Application menu"
      data-menubar
      className="flex h-full shrink-0 items-center"
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerMove={(e) => {
        // Browsers send synthetic moves on layout changes with the same coordinates; only a real move counts.
        if (quiet && Math.abs(e.clientX - quietAt.current.x) + Math.abs(e.clientY - quietAt.current.y) > 2) setQuiet(false);
      }}
      onPointerLeave={() => quiet && setQuiet(false)}
    >
      {items.map((m, i) => (
        <button
          key={m.label}
          data-menubar-item
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === i}
          aria-label={collapsed ? "Application menu" : undefined}
          title={collapsed ? "Application menu" : undefined}
          tabIndex={focusIdx === i ? 0 : -1}
          className={`flex h-[24px] items-center rounded px-[7px] text-[12.5px] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${
            open?.index === i ? "bg-hover text-fg" : quiet ? "text-fg" : "text-fg hover:bg-hover"
          } ${collapsed ? "w-[28px] justify-center !px-0" : ""} ${!collapsed && menus[i]?.id === "app" ? "font-black tracking-tight !text-accent" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            if (open?.index === i) close();
            else openAt(i, false);
          }}
          onMouseEnter={() => open && open.index !== i && openAt(i, false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              focusButton((i + (e.key === "ArrowRight" ? 1 : -1) + count) % count);
            } else if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              openAt(i, true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              restoreFocus();
            } else if (e.key === "Home") (e.preventDefault(), focusButton(0));
            else if (e.key === "End") (e.preventDefault(), focusButton(count - 1));
          }}
        >
          {collapsed ? <MenuIcon size={15} strokeWidth={1.7} /> : m.label}
        </button>
      ))}
      {open && current && anchor && (
        <Menu
          key={open.index}
          x={anchor.left}
          y={anchor.bottom + 2}
          items={current.items}
          label={current.label}
          minWidth={collapsed ? 180 : 240}
          autoActivate={open.keyboard}
          onClose={close}
          ignoreOutside={(t) => !!t.closest("[data-menubar]")}
          onNavigate={
            collapsed
              ? undefined
              : (dir) => {
                  const n = (open.index + dir + items.length) % items.length;
                  setFocusIdx(n);
                  setOpen({ index: n, keyboard: true });
                }
          }
        />
      )}
      <AboutDialog />
    </div>
  );
}

function AboutDialog() {
  const [show, setShow] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = () => setShow(true);
    window.addEventListener("rex:about", on);
    return () => window.removeEventListener("rex:about", on);
  }, []);
  useEffect(() => {
    if (show) ok.current?.focus();
  }, [show]);
  if (!show) return null;
  const rows: [string, string][] = [
    ["Version", pkg.version],
    ["Next.js", pkg.dependencies.next.replace(/^\^/, "")],
    ["React", reactVersion],
    ["Monaco", pkg.dependencies["@monaco-editor/react"].replace(/^\^/, "")],
    ["Platform", `${isMac() ? "macOS" : "Windows / Linux"} · ${typeof navigator !== "undefined" ? navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? "browser" : ""}`],
  ];
  return (
    <div className="scrim fixed inset-0 z-[80] flex items-center justify-center" onMouseDown={() => setShow(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="popover w-[380px] max-w-[92vw] p-5"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setShow(false);
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div id="about-title" className="text-[20px] font-black tracking-tight text-accent">
              REX
            </div>
            <div className="mt-1 text-[12px] text-muted">{pkg.description}</div>
          </div>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={() => setShow(false)}>
            <X size={14} />
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[90px_1fr] gap-y-1 text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="truncate font-mono text-[11.5px]">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n"));
              setShow(false);
            }}
          >
            Copy
          </button>
          <button ref={ok} className="btn btn-primary" onClick={() => setShow(false)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}


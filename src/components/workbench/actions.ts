"use client";
import { pickFolder } from "@/components/ui/FolderPicker";
import {
  Blocks,
  BookOpen,
  Clapperboard,
  FileCode2,
  FileDiff,
  FileJson,
  FileText,
  FolderCog,
  Globe,
  History,
  Image,
  Keyboard,
  LayoutDashboard,
  Settings,
  SquareKanban,
  WandSparkles,
  type LucideIcon, Cable, ServerCog, Network } from "lucide-react";
import { api } from "@/lib/client";
import { confirmDialog, promptDialog } from "@/components/ui/dialog";
import { LAYOUT_DEFAULTS, useWorkbench, type Activity, type ProjectHubIntent, type Tab, type TabSpec } from "@/store/workbench";
import { getSetting, useSettingsStore } from "@/store/settings";
import { SETTINGS_BY_KEY, type NumberSetting } from "@/lib/userSettings";
import type { ProviderStatus } from "@/lib/types";

// ------------------------------------------------------------------ tabs

export const TAB_ICON: Record<TabSpec["kind"], LucideIcon> = {
  dashboard: LayoutDashboard,
  board: SquareKanban,
  file: FileCode2,
  deliverable: FileText,
  run: History,
  seo: Globe,
  graphics: Image,
  video: Clapperboard,
  project: FolderCog,
  settings: Settings,
  diff: FileDiff,
  create: WandSparkles,
  extension: Blocks,
  welcome: BookOpen,
  shortcuts: Keyboard,
  settingsJson: FileJson,
  connections: Cable,
  ops: ServerCog,
  swarm: Network,
  swarms: Network,
};

/** Closes the given tabs, asking once if any of them has unsaved changes. */
export async function closeTabs(ids: string[]): Promise<boolean> {
  const s = useWorkbench.getState();
  const targets = s.tabs.filter((t) => ids.includes(t.id));
  if (!targets.length) return true;
  const dirty = targets.filter((t) => t.dirty);
  if (dirty.length && getSetting<boolean>("workbench.confirmBeforeCloseDirty")) {
    const ok = await confirmDialog({
      title: dirty.length === 1 ? `Close "${dirty[0].title}" without saving?` : `Close ${dirty.length} tabs without saving?`,
      message: "Your unsaved changes will be lost.",
      confirmLabel: "Don't save",
      danger: true,
    });
    if (!ok) return false;
  }
  for (const t of targets) useWorkbench.getState().closeTab(t.id);
  return true;
}

export const closeTab = (id: string) => closeTabs([id]);
export const closeOthers = (id: string) => closeTabs(useWorkbench.getState().tabs.filter((t) => t.id !== id).map((t) => t.id));
export const closeAll = () => closeTabs(useWorkbench.getState().tabs.map((t) => t.id));
export function closeToTheRight(id: string) {
  const tabs = useWorkbench.getState().tabs;
  const i = tabs.findIndex((t) => t.id === id);
  return closeTabs(tabs.slice(i + 1).map((t) => t.id));
}

export function cycleTab(dir: 1 | -1) {
  const { tabs, activeTabId, setActiveTab } = useWorkbench.getState();
  if (tabs.length < 2) return;
  const i = Math.max(0, tabs.findIndex((t) => t.id === activeTabId));
  setActiveTab(tabs[(i + dir + tabs.length) % tabs.length].id);
}

export const activeTab = (): Tab | null => {
  const s = useWorkbench.getState();
  return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
};

// ------------------------------------------------------------------ activities

const STUDIO_TABS: Partial<Record<Activity, { spec: TabSpec; title: string }>> = {
  seo: { spec: { kind: "seo" }, title: "SEO & AEO" },
  graphics: { spec: { kind: "graphics" }, title: "Graphics Studio" },
  create: { spec: { kind: "create" }, title: "Create Studio" },
  settings: { spec: { kind: "settings" }, title: "Settings" },
};

/**
 * Activity bar click: toggles/switches the sidebar like VS Code, and for studio
 * activities (SEO, Graphics, Create, Settings) also opens/focuses their editor tab.
 */
export function activate(a: Activity) {
  const s = useWorkbench.getState();
  const wasActive = s.activity === a && s.sidebarOpen;
  s.setActivity(a);
  const studio = STUDIO_TABS[a];
  if (studio && !wasActive) {
    // Keep an already-open Create tab (it may carry a jobId).
    const existing = s.tabs.find((t) => t.spec.kind === studio.spec.kind);
    if (existing) s.setActiveTab(existing.id);
    else s.openTab(studio.spec, studio.title);
  }
}

/** Shows an activity's sidebar without toggling it closed (keyboard shortcuts, links). */
export function showActivity(a: Activity) {
  useWorkbench.setState({ activity: a, sidebarOpen: true });
}

/** Extensions view: a page in Mission mode, the sidebar in Code mode. */
export function openExtensions() {
  const s = useWorkbench.getState();
  if (s.layoutMode === "mission") s.setMission({ missionPage: "@extensions" });
  else showActivity("extensions");
}
export const openConnections = () => useWorkbench.getState().openTab({ kind: "connections" }, "Connections");
export const openOps = () => useWorkbench.getState().openTab({ kind: "ops" }, "Ops");
export const openSwarms = () => useWorkbench.getState().openTab({ kind: "swarms" }, "Swarms");
export function toggleLayoutMode() {
  const s = useWorkbench.getState();
  s.setLayoutMode(s.layoutMode === "mission" ? "code" : "mission");
}

// ------------------------------------------------------------------ projects

export async function createProject(opts: { name: string; description?: string; repo_path?: string }) {
  const s = useWorkbench.getState();
  try {
    const p = await api<{ id: string; name: string }>("/api/projects", { method: "POST", json: opts });
    await s.loadProjects();
    s.setProject(p.id);
    s.openTab({ kind: "board", projectId: p.id }, `${p.name} · Board`);
    s.log("ok", "projects", `Created project ${p.name}`);
    s.bump();
    return p;
  } catch (e) {
    s.log("error", "projects", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** ⌘N — prompts for a name and creates the project. */
export async function newProjectFlow() {
  const name = await promptDialog({ title: "New project", message: "What are you building? You can add a description and repo later.", placeholder: "Project name" });
  if (name) await createProject({ name });
}

/** "Open folder as project" — prompts for an absolute repo path and derives the name. */
export async function openFolderFlow() {
  // Finder / in-app folder explorer instead of typing a path.
  const repo = await pickFolder({
    title: "Open folder as project",
    message: "Pick a local folder or git repository. Engineering and QA agents work inside it.",
    confirmLabel: "Open as project",
  });
  if (!repo) return;
  const clean = repo.replace(/\/+$/, "");
  const guess = clean.split("/").pop() || "project";
  const name = await promptDialog({ title: "Project name", initial: guess, placeholder: "Project name" });
  if (name) await createProject({ name, repo_path: clean });
}

/**
 * Opens the Project hub (general, repository & git, servers, uptime, deploy, connections, agents),
 * optionally on a section and asking it to open a form (`intent`).
 */
export function openProjectHub(projectId?: string | null, section?: string, intent?: ProjectHubIntent) {
  const s = useWorkbench.getState();
  const p = s.projects.find((x) => x.id === (projectId ?? s.projectId));
  if (!p) {
    s.log("error", "projects", "Create or select a project first.");
    return;
  }
  s.openTab({ kind: "project", projectId: p.id, section, intent: intent ? { kind: intent, key: Date.now() } : undefined }, `${p.name} · Project`);
}
export const openProjectSettings = (projectId?: string | null) => openProjectHub(projectId);
export const connectRepository = (projectId?: string | null) => openProjectHub(projectId, "git", "connect-repo");
export const addProjectServer = (projectId?: string | null) => openProjectHub(projectId, "servers", "add-server");
export const addUptimeMonitor = (projectId?: string | null) => openProjectHub(projectId, "uptime", "add-monitor");

/** File > Clone Repository…: clones a remote into a new folder and creates a project for it. */
export async function cloneRepositoryFlow() {
  const url = await promptDialog({ title: "Clone repository", message: "Remote URL (https://… or git@…)", placeholder: "https://github.com/owner/repo.git" });
  if (!url?.trim()) return;
  const guess = url.trim().replace(/\.git$/, "").split(/[/:]/).pop() || "repo";
  const st = useWorkbench.getState();
  const base = st.projects.find((x) => x.id === st.projectId)?.repo_path?.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  const parent = await pickFolder({ title: "Clone into…", message: `Pick the folder to clone ${guess} into.`, startIn: base || null, confirmLabel: "Clone here" });
  if (!parent) return;
  const name = (await promptDialog({ title: "New folder name", message: `Created inside ${parent}`, initial: guess, placeholder: guess }))?.trim().replace(/^\/+|\/+$/g, "");
  if (!name) return;
  const folder = `${parent.replace(/\/+$/, "")}/${name}`;
  const p = await createProject({ name });
  if (!p) return;
  const s = useWorkbench.getState();
  try {
    s.log("info", "git", `Cloning ${url.trim()}…`);
    await api(`/api/projects/${p.id}/git`, { method: "POST", json: { action: "clone", url: url.trim(), folder } });
    await s.loadProjects();
    s.bump();
    s.log("ok", "git", `Cloned into ${folder}`);
    openProjectHub(p.id, "git");
  } catch (e) {
    s.log("error", "git", e instanceof Error ? e.message : String(e));
    openProjectHub(p.id, "git");
  }
}

export function switchProject(id: string) {
  const s = useWorkbench.getState();
  const p = s.projects.find((x) => x.id === id);
  if (!p) return;
  s.setProject(id);
  s.openTab({ kind: "board", projectId: p.id }, `${p.name} · Board`);
}

// ------------------------------------------------------------------ focus regions

/** ⌘1/⌘2/⌘3: moves keyboard focus into a workbench region. */
export function focusRegion(region: "sidebar" | "editor" | "agent") {
  const s = useWorkbench.getState();
  if (region === "sidebar" && !s.sidebarOpen) s.setLayout({ sidebarOpen: true });
  if (region === "agent" && !s.agentOpen) s.toggleAgent(true);
  requestAnimationFrame(() => {
    const root = document.querySelector<HTMLElement>(`[data-region="${region}"]`);
    if (!root) return;
    const preferred =
      region === "agent"
        ? root.querySelector<HTMLElement>("textarea")
        : region === "editor"
          ? root.querySelector<HTMLElement>(".monaco-editor textarea, [data-editor-body] input, [data-editor-body] textarea, [data-editor-body] button")
          : root.querySelector<HTMLElement>("[data-sidebar-body] input, [data-sidebar-body] button, [data-sidebar-body] [tabindex]");
    (preferred ?? root).focus();
  });
}

// ------------------------------------------------------------------ editor / files

/** Asks the active file editor (or every open one with `all`) to save. FileEditor listens for these events. */
export function saveActive() {
  const t = activeTab();
  if (t) window.dispatchEvent(new CustomEvent("rex:save", { detail: { tabId: t.id } }));
}
export function saveAll() {
  window.dispatchEvent(new CustomEvent("rex:save-all"));
}

/** File > New File: creates an empty file in the active project's repo and opens it. */
export async function newFileFlow() {
  const s = useWorkbench.getState();
  const project = s.projects.find((p) => p.id === s.projectId);
  if (!project?.repo_path) {
    s.log("error", "files", "The current project has no repository folder. Link one in project settings.");
    return;
  }
  const path = await promptDialog({ title: "New file", message: `Path relative to ${project.repo_path}`, placeholder: "src/new-file.ts" });
  const rel = path?.trim().replace(/^\/+/, "");
  if (!rel) return;
  try {
    await api("/api/files", { method: "POST", json: { projectId: project.id, op: "create", path: rel } });
    s.bump();
    s.openTab({ kind: "file", projectId: project.id, path: rel }, rel.split("/").pop() ?? rel);
  } catch (e) {
    s.log("error", "files", e instanceof Error ? e.message : String(e));
  }
}

export const openSettingsJson = () => useWorkbench.getState().openTab({ kind: "settingsJson" }, "settings.json");
export const openShortcuts = () => useWorkbench.getState().openTab({ kind: "shortcuts" }, "Keyboard Shortcuts");
/** Help ▸ Welcome: the setup screen in Mission mode, the Get started tab in Code mode. */
export const openWelcome = () => {
  const s = useWorkbench.getState();
  if (s.layoutMode === "mission") s.setOnboarding(true);
  else s.openTab({ kind: "welcome" }, "Welcome");
};
export const openSetup = () => useWorkbench.getState().setOnboarding(true);

// ------------------------------------------------------------------ view

/** View > Zoom In/Out/Reset (workbench.zoomLevel, 10% per step). */
export function zoom(dir: 1 | -1 | 0) {
  const def = SETTINGS_BY_KEY["workbench.zoomLevel"] as NumberSetting;
  const cur = getSetting<number>("workbench.zoomLevel");
  const next = dir === 0 ? 0 : Math.max(def.min ?? -5, Math.min(def.max ?? 8, cur + dir));
  useSettingsStore.getState().set("workbench.zoomLevel", next);
}

export function resetLayout() {
  useWorkbench.getState().setLayout({ ...LAYOUT_DEFAULTS, panelMaximized: false, sidebarOpen: true });
}

export function togglePanelMaximized() {
  const s = useWorkbench.getState();
  s.setLayout({ panelMaximized: !s.panelMaximized });
  s.togglePanel(true);
}

// ------------------------------------------------------------------ terminal / agents

/**
 * Terminal menu actions. The TerminalPanel may handle `rex:terminal-new` / `rex:terminal-kill`
 * (calling preventDefault); otherwise we fall back to its toolbar buttons.
 */
function terminalCommand(event: "rex:terminal-new" | "rex:terminal-kill", buttonTitle: string) {
  useWorkbench.getState().setPanelTab("terminal");
  // Wait for the panel to mount.
  setTimeout(() => {
    const ev = new CustomEvent(event, { cancelable: true });
    if (window.dispatchEvent(ev)) document.querySelector<HTMLButtonElement>(`[aria-label="Panel"] button[title="${buttonTitle}"]`)?.click();
  }, 60);
}
export const newTerminal = () => terminalCommand("rex:terminal-new", "New Terminal");
export const killTerminal = () => terminalCommand("rex:terminal-kill", "Kill Terminal");

/** Agents > New Conversation. AgentPanel may handle `rex:agent-new-conversation`; else click its button. */
export function newConversation() {
  useWorkbench.getState().toggleAgent(true);
  setTimeout(() => {
    const ev = new CustomEvent("rex:agent-new-conversation", { cancelable: true });
    if (window.dispatchEvent(ev)) document.querySelector<HTMLButtonElement>('[data-region="agent"] button[aria-label="New conversation"]')?.click();
  }, 60);
}

/** File > New Task: a fresh conversation with the composer focused (Mission: closes any page first). */
export function newTask() {
  const s = useWorkbench.getState();
  if (s.layoutMode === "mission") s.setMission({ missionPage: null });
  newConversation();
  setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-region="agent"] textarea')?.focus(), 140);
}

/** Re-detects installed terminal agents. */
export async function recheckAgents() {
  const s = useWorkbench.getState();
  try {
    const fresh = await api<ProviderStatus[]>("/api/agents?refresh=1");
    useWorkbench.setState({ providers: fresh });
    s.log("ok", "agents", `${fresh.filter((a) => a.available).length} of ${fresh.length} agents installed`);
  } catch (e) {
    s.log("error", "agents", e instanceof Error ? e.message : String(e));
  }
}

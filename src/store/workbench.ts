"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/client";
import { DEPARTMENTS, type Department } from "@/lib/departments";
import type { CommandContribution, PipelineContribution, ThemeContribution } from "@/lib/plugins/types";
import type { AgentPrefs, Project, ProviderId, ProviderStatus } from "@/lib/types";

export type Activity =
  | "command"
  | "plan"
  | "code"
  | "search"
  | "scm"
  | "library"
  | "seo"
  | "create"
  | "graphics"
  | "video"
  | "runs"
  | "extensions"
  | "settings";

export interface TerminalAgentLaunch {
  id: ProviderId;
  action: "install" | "login" | "interactive";
  /** Interactive only: start the agent with this department's role. */
  department?: string;
  model?: string;
  /** Interactive only: Agent-panel conversation whose agent session to open (panel ⇄ terminal sync). */
  threadId?: string;
}

export type PluginDepartment = Department & { pluginId?: string };
export type PluginTheme = ThemeContribution & { pluginId: string };
export type ProjectHubIntent = "connect-repo" | "add-server" | "add-monitor";

export type TabSpec =
  | { kind: "dashboard" }
  | { kind: "board"; projectId: string }
  | { kind: "file"; projectId: string; path: string }
  | { kind: "deliverable"; id: string }
  | { kind: "run"; id: string }
  | { kind: "seo" }
  | { kind: "graphics" }
  | { kind: "video"; file?: string }
  /**
   * Project hub. `section` deep-links a hub section (general | git | servers | uptime | deploy | connections | agents);
   * `intent` asks the hub to open a form once (ignored when older than ~10s, since tabs persist).
   */
  | { kind: "project"; projectId: string; section?: string; intent?: { kind: ProjectHubIntent; key: number } }
  | { kind: "settings" }
  | { kind: "diff"; projectId: string; path: string; staged: boolean; from?: string }
  | { kind: "create"; jobId?: string }
  | { kind: "extension"; id: string }
  | { kind: "welcome" }
  | { kind: "shortcuts" }
  | { kind: "settingsJson" }
  | { kind: "connections"; category?: string }
  /** Agent swarm (DAG of department steps); `swarms` = list for the active project, `compose` (timestamp) opens the composer. */
  | { kind: "swarm"; id: string }
  | { kind: "swarms"; compose?: number }
  | { kind: "ops"; section?: "overview" | "servers" | "traffic" | "docker" | "k8s" | "uptime" | "git" };

/** Default layout sizes (px). Double-clicking a sash resets to these. */
export const LAYOUT_DEFAULTS = { sidebarWidth: 256, agentWidth: 420, panelHeight: 260 } as const;
export const LAYOUT_LIMITS = {
  sidebar: { min: 170, max: 640, hideBelow: 110 },
  agent: { min: 320, max: 900 },
  panel: { min: 120 },
} as const;

/** Mission mode: Workspace panel tabs, and default column widths (px). */
export type MissionTab = "pipeline" | "live" | "output" | "issues" | "code";
export const MISSION_DEFAULTS = { rail: 248, workspace: 520 } as const;
export const MISSION_LIMITS = { rail: { min: 200, max: 380 }, workspace: { min: 380, max: 1100 } } as const;

export type ToastLevel = "info" | "ok" | "error" | "warn";
export interface Toast {
  id: number;
  ts: number;
  level: ToastLevel;
  source: string;
  text: string;
}

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export interface Tab {
  id: string;
  title: string;
  spec: TabSpec;
  dirty?: boolean;
}

export interface LogLine {
  ts: number;
  level: "info" | "ok" | "error";
  source: string;
  text: string;
}

function tabId(spec: TabSpec): string {
  switch (spec.kind) {
    case "board":
    case "project":
      return `${spec.kind}:${spec.projectId}`;
    case "file":
      return `file:${spec.projectId}:${spec.path}`;
    case "diff":
      return `diff:${spec.projectId}:${spec.staged ? "staged" : "work"}:${spec.path}`;
    case "extension":
      return `extension:${spec.id}`;
    case "deliverable":
    case "run":
    case "swarm":
      return `${spec.kind}:${spec.id}`;
    default:
      return spec.kind;
  }
}

interface WorkbenchState {
  activity: Activity;
  sidebarOpen: boolean;
  agentOpen: boolean;
  panelOpen: boolean;
  paletteOpen: boolean;
  /** "files" = ⌘P quick open, "commands" = ⌘K/⌘⇧P palette */
  paletteMode: "commands" | "files";
  panelTab: "output" | "terminal";
  projectId: string | null;
  departments: PluginDepartment[];
  pluginCommands: (CommandContribution & { pluginId: string })[];
  pluginPipelines: (PipelineContribution & { pluginId: string })[];
  /** Color themes contributed by enabled extensions. */
  themes: PluginTheme[];
  /** First /api/plugins/contributions load finished (until then a cached color theme stays applied). */
  themesLoaded: boolean;
  /** Color Theme quick pick (⌘K ⌘T / "Preferences: Color Theme"). */
  themePickerOpen: boolean;
  setThemePicker: (open: boolean) => void;
  /** Request for the Extensions view to prefill its search box (e.g. "@themes"). */
  extensionsQuery: { q: string; key: number } | null;
  searchExtensions: (q: string) => void;
  projects: Project[];
  /** Terminal AI agents (built-in + extension-contributed). */
  providers: ProviderStatus[];
  agentPrefs: AgentPrefs;
  tabs: Tab[];
  activeTabId: string | null;
  logs: LogLine[];
  /** Bumped whenever server data changes so views can refetch. */
  version: number;

  setActivity: (a: Activity) => void;
  toggleSidebar: () => void;
  toggleAgent: (open?: boolean) => void;
  togglePanel: (open?: boolean) => void;
  setPalette: (open: boolean, mode?: "commands" | "files") => void;
  setPanelTab: (t: "output" | "terminal") => void;
  loadContributions: () => Promise<void>;
  setProject: (id: string | null) => void;
  saveAgentPrefs: (p: Partial<AgentPrefs>) => Promise<void>;
  /** Pending request for the integrated terminal to start a terminal agent (install / sign in / interactive). */
  /**
   * "mission" = Manus-style task view (conversation + workspace: pipeline, live
   * agent, output, issues); "code" = the VS Code-style IDE.
   */
  layoutMode: "mission" | "code";
  setLayoutMode: (m: "mission" | "code") => void;
  /** The Agent panel's current conversation, so other views (Live tab) can follow it. */
  agentThread: { department: string; threadId: string | null };
  setAgentThread: (t: { department: string; threadId: string | null }) => void;
  /** Request for the Agent panel to switch to a conversation (threadId null = new). */
  /** Boot loads that are failing right now (server starting / unreachable) → "Reconnecting" banner. */
  connectionLost: string[];
  setConnectionLost: (what: string, lost: boolean) => void;
  conversationRequest: { department: string; threadId: string | null; key: number } | null;
  openConversation: (t: { department: string; threadId: string | null }) => void;
  // ---- Mission mode (persisted except missionPage)
  missionRailWidth: number;
  missionWorkspaceWidth: number;
  missionWorkspaceOpen: boolean;
  missionTab: MissionTab;
  /** Tab id shown as a full "page" over the Mission conversation (Board, studios, deliverables…); null = conversation. */
  missionPage: string | null;
  /** Last time the Output tab was viewed (ms) — drives its "new" badge. */
  missionOutputSeen: number;
  setMission: (p: Partial<Pick<WorkbenchState, "missionRailWidth" | "missionWorkspaceWidth" | "missionWorkspaceOpen" | "missionTab" | "missionPage" | "missionOutputSeen">>) => void;
  terminalLaunch: { key: number; agent?: TerminalAgentLaunch; connection?: { id: string }; ssh?: { serverId: string } } | null;
  launchTerminal: (agent: TerminalAgentLaunch) => void;
  /** First-run setup screen (project → agents → connections). Not persisted; Help ▸ Welcome reopens it. */
  onboardingOpen: boolean;
  setOnboarding: (open: boolean) => void;
  /** Sign in to a third-party connection in the integrated terminal. */
  launchConnection: (id: string) => void;
  /** Open an SSH session to an Ops server in the integrated terminal. */
  launchSsh: (serverId: string) => void;
  clearTerminalLaunch: () => void;
  loadProjects: () => Promise<void>;
  loadProviders: () => Promise<void>;
  openTab: (spec: TabSpec, title: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabDirty: (id: string, dirty: boolean) => void;
  log: (level: LogLine["level"], source: string, text: string) => void;
  bump: () => void;
  /** Message queued for the agent panel (e.g. "Delegate to AI" from a task). */
  agentDraft: { department: string; brief: string; taskId?: string | null; context?: string } | null;
  delegate: (d: WorkbenchState["agentDraft"]) => void;

  // ---- layout (persisted)
  sidebarWidth: number;
  agentWidth: number;
  panelHeight: number;
  panelMaximized: boolean;
  setLayout: (p: Partial<Pick<WorkbenchState, "sidebarWidth" | "agentWidth" | "panelHeight" | "panelMaximized" | "sidebarOpen">>) => void;

  // ---- boot
  /** First /api/projects load finished (success or failure). */
  projectsLoaded: boolean;

  // ---- agent runs
  /** Number of agent runs currently running (polled by the Workbench). */
  runningRuns: number;
  setRunningRuns: (n: number) => void;

  // ---- notifications
  toasts: Toast[];
  /** Every toast raised this session, newest last (bell in the status bar). */
  notifications: Toast[];
  unreadNotifications: number;
  toast: (level: ToastLevel, text: string, source?: string) => void;
  dismissToast: (id: number) => void;
  clearNotifications: () => void;
  markNotificationsRead: () => void;

  // ---- command palette
  /** Most-recently-run palette command ids, newest first (persisted). */
  recentCommands: string[];
  pushRecentCommand: (id: string) => void;

  /** Opens (or focuses) the Settings tab and scrolls to a section anchor, e.g. "settings-agents". */
  openSettings: (section?: string) => void;
}

function scrollToAnchor(id: string) {
  // The Settings view may still be mounting: retry for ~2s.
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (tries++ < 40) setTimeout(tick, 50);
  };
  tick();
}

export const useWorkbench = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      activity: "command",
      sidebarOpen: true,
      agentOpen: true,
      panelOpen: false,
      paletteOpen: false,
      paletteMode: "commands",
      panelTab: "output",
      projectId: null,
      departments: DEPARTMENTS,
      pluginCommands: [],
      pluginPipelines: [],
      themes: [],
      themesLoaded: false,
      themePickerOpen: false,
      setThemePicker: (open) => set({ themePickerOpen: open }),
      extensionsQuery: null,
      searchExtensions: (q) => set({ extensionsQuery: { q, key: Date.now() } }),
      projects: [],
      providers: [],
      agentPrefs: { defaultAgent: "claude-cli", departments: {}, models: {} },
      terminalLaunch: null,
      layoutMode: "mission",
      setLayoutMode: (m) => set({ layoutMode: m }),
      agentThread: { department: "ceo", threadId: null },
      conversationRequest: null,
      connectionLost: [],
      setConnectionLost: (what, lost) =>
        set((st) => {
          const has = st.connectionLost.includes(what);
          if (lost === has) return st;
          return { connectionLost: lost ? [...st.connectionLost, what] : st.connectionLost.filter((x) => x !== what) };
        }),
      openConversation: (t) => set({ conversationRequest: { ...t, key: Date.now() } }),
      missionRailWidth: MISSION_DEFAULTS.rail,
      missionWorkspaceWidth: MISSION_DEFAULTS.workspace,
      missionWorkspaceOpen: true,
      missionTab: "pipeline",
      missionPage: null,
      missionOutputSeen: 0,
      setMission: (p) => set(p),
      setAgentThread: (t) => set((s) => (s.agentThread.department === t.department && s.agentThread.threadId === t.threadId ? s : { agentThread: t })),
      tabs: [{ id: "welcome", title: "Welcome", spec: { kind: "welcome" } }],
      activeTabId: "welcome",
      logs: [],
      version: 0,
      agentDraft: null,
      sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth,
      agentWidth: LAYOUT_DEFAULTS.agentWidth,
      panelHeight: LAYOUT_DEFAULTS.panelHeight,
      panelMaximized: false,
      projectsLoaded: false,
      runningRuns: 0,
      toasts: [],
      notifications: [],
      unreadNotifications: 0,
      recentCommands: [],

      setLayout: (p) => set(p),
      setRunningRuns: (n) => set((s) => (s.runningRuns === n ? s : { runningRuns: n })),
      toast: (level, text, source = "") => {
        const t: Toast = { id: ++toastSeq, ts: Date.now(), level, source, text };
        set((s) => ({
          toasts: [...s.toasts.slice(-4), t],
          notifications: [...s.notifications.slice(-99), t],
          unreadNotifications: s.unreadNotifications + 1,
        }));
        const timer = setTimeout(() => get().dismissToast(t.id), level === "error" ? 8000 : 4000);
        toastTimers.set(t.id, timer);
      },
      dismissToast: (id) => {
        clearTimeout(toastTimers.get(id));
        toastTimers.delete(id);
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      clearNotifications: () => set({ notifications: [], unreadNotifications: 0 }),
      markNotificationsRead: () => set({ unreadNotifications: 0 }),
      pushRecentCommand: (id) => set((s) => ({ recentCommands: [id, ...s.recentCommands.filter((x) => x !== id)].slice(0, 8) })),
      openSettings: (section) => {
        get().openTab({ kind: "settings" }, "Settings");
        if (section && typeof document !== "undefined") scrollToAnchor(section);
      },

      setActivity: (a) =>
        set((s) => (s.activity === a ? { sidebarOpen: !s.sidebarOpen } : { activity: a, sidebarOpen: true })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleAgent: (open) => set((s) => ({ agentOpen: open ?? !s.agentOpen })),
      togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),
      setPalette: (open, mode = "commands") => set({ paletteOpen: open, paletteMode: mode }),
      setPanelTab: (t) => set({ panelTab: t, panelOpen: true }),
      loadContributions: async () => {
        const c = await api<{
          departments: PluginDepartment[];
          commands: WorkbenchState["pluginCommands"];
          pipelines: WorkbenchState["pluginPipelines"];
          themes?: PluginTheme[];
        }>("/api/plugins/contributions");
        set({ departments: c.departments, pluginCommands: c.commands, pluginPipelines: c.pipelines, themes: c.themes ?? [], themesLoaded: true });
      },
      setProject: (id) => set({ projectId: id }),
      onboardingOpen: false,
      setOnboarding: (open) => set({ onboardingOpen: open }),
      launchTerminal: (agent) => set({ terminalLaunch: { key: Date.now(), agent }, panelOpen: true, panelTab: "terminal" }),
      clearTerminalLaunch: () => set({ terminalLaunch: null }),
      launchConnection: (id) => set({ terminalLaunch: { key: Date.now(), connection: { id } }, panelOpen: true, panelTab: "terminal" }),
      launchSsh: (serverId) => set({ terminalLaunch: { key: Date.now(), ssh: { serverId } }, panelOpen: true, panelTab: "terminal" }),
      saveAgentPrefs: async (p) => {
        const agentPrefs = await api<AgentPrefs>("/api/agents/prefs", { method: "PUT", json: { ...get().agentPrefs, ...p } });
        set({ agentPrefs });
      },
      loadProjects: async () => {
        try {
          const projects = await api<Project[]>("/api/projects");
          const { projectId } = get();
          set({ projects, projectId: projectId && projects.some((p) => p.id === projectId) ? projectId : (projects[0]?.id ?? null) });
        } finally {
          if (!get().projectsLoaded) set({ projectsLoaded: true });
        }
      },
      loadProviders: async () => {
        const [providers, agentPrefs] = await Promise.all([api<ProviderStatus[]>("/api/agents"), api<AgentPrefs>("/api/agents/prefs")]);
        set({ providers, agentPrefs });
      },
      openTab: (spec, title) => {
        const id = tabId(spec);
        set((s) => ({
          tabs: s.tabs.some((t) => t.id === id) ? s.tabs.map((t) => (t.id === id ? { ...t, title, spec } : t)) : [...s.tabs, { id, title, spec }],
          activeTabId: id,
        }));
      },
      closeTab: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeTabId = s.activeTabId === id ? (tabs[Math.max(0, idx - 1)]?.id ?? null) : s.activeTabId;
          return { tabs, activeTabId };
        }),
      setActiveTab: (id) => set({ activeTabId: id }),
      setTabDirty: (id, dirty) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })),
      log: (level, source, text) => {
        set((s) => ({ logs: [...s.logs.slice(-499), { ts: Date.now(), level, source, text }] }));
        // Errors and successes surface as toasts; "info" stays in the Output panel only.
        if (level !== "info") get().toast(level, text, source);
      },
      bump: () => set((s) => ({ version: s.version + 1 })),
      delegate: (d) => set({ agentDraft: d, agentOpen: true }),
    }),
    {
      name: "rex-workbench",
      partialize: (s) => ({
        layoutMode: s.layoutMode,
        missionRailWidth: s.missionRailWidth,
        missionWorkspaceWidth: s.missionWorkspaceWidth,
        missionWorkspaceOpen: s.missionWorkspaceOpen,
        missionTab: s.missionTab,
        missionOutputSeen: s.missionOutputSeen,
        activity: s.activity,
        sidebarOpen: s.sidebarOpen,
        agentOpen: s.agentOpen,
        panelOpen: s.panelOpen,
        panelTab: s.panelTab,
        projectId: s.projectId,
        tabs: s.tabs.map((t) => ({ ...t, dirty: false })),
        activeTabId: s.activeTabId,
        sidebarWidth: s.sidebarWidth,
        agentWidth: s.agentWidth,
        panelHeight: s.panelHeight,
        panelMaximized: s.panelMaximized,
        recentCommands: s.recentCommands,
      }),
    },
  ),
);

export const useActiveProject = () => {
  const { projects, projectId } = useWorkbench();
  return projects.find((p) => p.id === projectId) ?? null;
};

/** Departments = built-in + those contributed by enabled plugins. */
export const useDepartments = () => {
  const departments = useWorkbench((s) => s.departments);
  const getDepartment = (id: string): PluginDepartment => departments.find((d) => d.id === id) ?? departments[0];
  return { departments, getDepartment };
};

/**
 * Terminal AI agents. `label(id)` never throws (old runs may reference an
 * agent whose extension was removed); `forDepartment` resolves the agent a
 * department should use: user choice → department default → global default →
 * first installed agent.
 */
export const useAgents = () => {
  const providers = useWorkbench((s) => s.providers);
  const prefs = useWorkbench((s) => s.agentPrefs);
  const departments = useWorkbench((s) => s.departments);
  const find = (id: ProviderId | null | undefined) => providers.find((p) => p.id === id);
  const label = (id: ProviderId | null | undefined) =>
    find(id)?.label ?? ({ "claude-cli": "Claude Code", "codex-cli": "Codex", anthropic: "Claude API (removed)" } as Record<string, string>)[id ?? ""] ?? id ?? "agent";
  // Installed and not known to have an expired / missing sign-in.
  const usable = (id: ProviderId | null | undefined): id is ProviderId => !!id && !!find(id)?.available && !find(id)?.authError;
  const forDepartment = (deptId: string): ProviderId => {
    const dept = departments.find((d) => d.id === deptId);
    const candidates = [prefs.departments[deptId], dept?.defaultProvider, prefs.defaultAgent];
    return candidates.find(usable) ?? providers.find((p) => p.available)?.id ?? candidates.find(Boolean) ?? "claude-cli";
  };
  const defaultAgent = (): ProviderId => (usable(prefs.defaultAgent) ? prefs.defaultAgent : (providers.find((p) => p.available)?.id ?? prefs.defaultAgent));
  return { agents: providers, prefs, find, label, forDepartment, defaultAgent, model: (id: ProviderId) => prefs.models[id] ?? "" };
};

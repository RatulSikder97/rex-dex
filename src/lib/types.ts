// Shared, client-safe domain types.

export const STAGES = ["idea", "planning", "building", "testing", "launched", "growing"] as const;
export type Stage = (typeof STAGES)[number];

export const TASK_STATUSES = ["backlog", "todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * An AI agent is a terminal CLI (Claude Code, Codex, Cursor Agent, Gemini CLI,
 * Ollama, …). Built-ins ship with REX; more are contributed by extensions.
 * No API keys: each CLI uses its own login.
 */
export type ProviderId = string;

export const BUILTIN_AGENTS = ["claude-cli", "codex-cli"] as const;

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface Project {
  id: string;
  name: string;
  description: string;
  stage: Stage;
  repo_path: string;
  website_url: string;
  /** Sanitized SVG markup ("" = monogram). Render only via svgDataUrl() in an <img>. */
  logo: string;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  detail: string;
  department: string;
  status: TaskStatus;
  priority: Priority;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface Run {
  id: string;
  project_id: string | null;
  task_id: string | null;
  thread_id: string | null;
  department: string;
  provider: ProviderId;
  brief: string;
  output: string;
  status: RunStatus;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export type DeliverableKind = "markdown" | "svg" | "html" | "json";

export interface Deliverable {
  id: string;
  project_id: string | null;
  run_id: string | null;
  department: string;
  kind: DeliverableKind;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

/** Status of one terminal AI agent, as reported by GET /api/agents. */
export interface ProviderStatus {
  id: ProviderId;
  label: string;
  description: string;
  icon: string;
  /** Installed and runnable (binary found on PATH). */
  available: boolean;
  /** Version line or the reason it's unavailable. */
  detail: string;
  /** Last run failed to sign in (expired / missing login). Cleared by a successful run. */
  authError: string | null;
  builtin: boolean;
  pluginId: string | null;
  /** Models the user can pick; empty = the CLI's own default. */
  models: string[];
  /** Shell command that installs the CLI (run in the integrated terminal). */
  install: string | null;
  /** Shell command that signs in (run in the integrated terminal). */
  login: string | null;
  /** Can be opened as an interactive TUI in the integrated terminal. */
  interactive: boolean;
  /** Can edit files in the repo when "edits" is allowed. */
  canEdit: boolean;
  /** Receives MCP servers contributed by extensions. */
  mcp: boolean;
  homepage: string | null;
}

/** User preferences for which agent each department uses. */
export interface AgentPrefs {
  /** Fallback agent for departments without an explicit choice. */
  defaultAgent: ProviderId;
  /** department id → agent id */
  departments: Record<string, ProviderId>;
  /** agent id → model */
  models: Record<ProviderId, string>;
}

/** Events streamed from a run over SSE. */
export type RunEvent =
  /** `at` = length of the output before this chunk, so clients can apply chunks idempotently. */
  | { type: "chunk"; text: string; at?: number }
  | { type: "status"; status: RunStatus; error?: string | null }
  | { type: "snapshot"; output: string; status: RunStatus; error?: string | null };

/** A third-party connection (GET /api/connections). */
export type ConnectionStatus = "available" | "disabled" | "needs-setup" | "needs-auth" | "connected" | "app-missing";

export interface ConnectionInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "analytics" | "seo" | "marketing" | "design" | "video" | "productivity" | "dev" | "commerce" | "social" | "other";
  departments: string[];
  kind: "mcp" | "app";
  auth: "oauth" | "browser-cli" | "agent-oauth" | "terminal" | "settings" | "none";
  authCommand: string | null;
  actions: ("open-media" | "export-fcpxml" | "export-ae-jsx")[];
  docs: string | null;
  setupHint: string;
  pluginId: string;
  /** Install source when the extension isn't installed yet. */
  source: string | null;
  installed: boolean;
  status: ConnectionStatus;
  statusDetail: string;
  /** Extension settings this connection needs (values are never returned). */
  settings: { key: string; title: string; description: string; secret: boolean; configured: boolean }[];
  /** Desktop app found on this machine (app connections). */
  appPath: string | null;
  connectedAt: number | null;
}


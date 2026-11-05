import { z } from "zod";

/**
 * REX plugin manifest (`rex-plugin.json`). Client-safe.
 *
 * Declarative contributions are always safe to load. A plugin with `main`
 * ships Node code (media providers); it stays inactive until the user
 * explicitly trusts it.
 */

const QuickAction = z.object({ label: z.string().min(1).max(60), prompt: z.string().max(4000) });

export const DepartmentContribution = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(40),
  role: z.string().max(120).default(""),
  icon: z.string().max(40).default("Bot"),
  color: z.string().max(20).default("#9da0a8"),
  /** Agent id (built-in "claude-cli" / "codex-cli" or one contributed by an extension). */
  defaultProvider: z.string().regex(/^[a-z0-9-]{2,40}$/).default("claude-cli"),
  usesRepo: z.boolean().default(false),
  outputKind: z.enum(["markdown", "svg", "html", "json"]).default("markdown"),
  system: z.string().min(1).max(20000),
  quickActions: z.array(QuickAction).max(12).default([]),
});

export const CommandContribution = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(80),
  department: z.string().min(1).max(40),
  prompt: z.string().min(1).max(8000),
});

export const McpServerContribution = z
  .object({
    /** Local (stdio) server: executable + args. */
    command: z.string().max(200).default(""),
    args: z.array(z.string().max(500)).max(40).default([]),
    /** Values may reference plugin settings as ${setting:KEY}. */
    env: z.record(z.string(), z.string().max(2000)).default({}),
    /** Remote server (streamable HTTP / SSE). Auth is the agent's own OAuth flow. */
    url: z.string().url().max(500).optional(),
    transport: z.enum(["stdio", "http", "sse"]).optional(),
    /** Only hand this server to these departments' runs (default: every department). */
    departments: z.array(z.string().max(40)).max(40).optional(),
  })
  .refine((s) => !!s.command || !!s.url, { message: "mcpServers entry needs a command or a url" });

/**
 * A third-party connection shown in the Connections hub (Google Search
 * Console, Figma, Premiere Pro, …). `mcp` connections expose a service to the
 * terminal agents through one of the extension's `mcpServers`; `app`
 * connections drive a desktop app on this Mac (open media, export projects).
 */
export const ConnectionContribution = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(""),
  icon: z.string().max(40).default("Plug"),
  category: z.enum(["analytics", "seo", "marketing", "design", "video", "productivity", "dev", "commerce", "social", "other"]).default("other"),
  /** Departments this connection is for (drives where it's offered + MCP scoping). */
  departments: z.array(z.string().max(40)).max(40).default([]),
  kind: z.enum(["mcp", "app"]).default("mcp"),
  /** mcp: name of the extension's mcpServers entry. */
  mcpServer: z.string().max(40).optional(),
  /**
   * How the user signs in:
   * - "agent-oauth": remote MCP; the agent opens the provider's OAuth page (run `/mcp` in Claude Code)
   * - "terminal": a CLI login (e.g. `gcloud auth application-default login`) run in the integrated terminal
   * - "settings": values in the extension's settings (paths, ids, tokens)
   * - "none": local app / no auth
   */
  /** "oauth": REX runs the provider's browser sign-in (remote MCP with OAuth) and passes the token to agents. */
  /** "browser-cli": a CLI login that opens the browser (gh, gcloud), run by REX in the background. */
  auth: z.enum(["oauth", "browser-cli", "agent-oauth", "terminal", "settings", "none"]).default("none"),
  authCommand: z.string().max(600).optional(),
  /** Shell command that exits 0 when signed in (terminal / browser-cli auth). */
  checkCommand: z.string().max(400).optional(),
  /** Shell command printing a bearer token for the remote MCP server (e.g. `gh auth token`). */
  tokenCommand: z.string().max(300).optional(),
  /** app: macOS application names to look for in /Applications (prefix match, e.g. "Adobe Premiere Pro"). */
  apps: z.array(z.string().max(80)).max(6).default([]),
  /** app: built-in REX actions this connection supports. */
  actions: z.array(z.enum(["open-media", "export-fcpxml", "export-ae-jsx"])).max(6).default([]),
  docs: z.string().max(300).optional(),
  setupHint: z.string().max(600).default(""),
});

export const SettingContribution = z.object({
  key: z.string().regex(/^[A-Za-z0-9_]{1,60}$/),
  title: z.string().min(1).max(80),
  description: z.string().max(300).default(""),
  secret: z.boolean().default(false),
});

/** A media pipeline preset shown in Create Studio. `brief` pre-fills the form. */
export const PipelineContribution = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(80),
  kind: z.enum(["video", "audio"]),
  description: z.string().max(300).default(""),
  aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
  targetSeconds: z.number().min(5).max(900).optional(),
  style: z.string().max(2000).default(""),
  brief: z.string().max(4000).default(""),
});

/**
 * A terminal AI agent: a CLI REX drives non-interactively for runs, and can
 * open interactively in the integrated terminal. No API keys — the CLI uses
 * its own login (`login` is run in the terminal for the user).
 *
 * Arg placeholders: {model}, {cwd}, and {prompt} (only when prompt = "arg").
 * The department's role is prepended to the prompt.
 */
export const AgentContribution = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(40),
  description: z.string().max(300).default(""),
  icon: z.string().max(40).default("Bot"),
  homepage: z.string().max(300).optional(),
  /** Executable on PATH (no shell). */
  command: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
  versionArgs: z.array(z.string().max(100)).max(10).default(["--version"]),
  /** Non-interactive invocation. */
  args: z.array(z.string().max(500)).max(40).default([]),
  readOnlyArgs: z.array(z.string().max(200)).max(20).default([]),
  editArgs: z.array(z.string().max(200)).max(20).default([]),
  /** Appended when a model is chosen, e.g. ["--model", "{model}"]. */
  modelArgs: z.array(z.string().max(200)).max(6).default([]),
  models: z.array(z.string().max(100)).max(60).default([]),
  /** Discover models by running `command ...args` and reading the first column (e.g. `ollama list`). */
  listModels: z.object({ args: z.array(z.string().max(100)).max(10), skipHeader: z.boolean().default(true) }).optional(),
  prompt: z.enum(["stdin", "arg"]).default("stdin"),
  output: z.enum(["text", "claude-stream-json", "codex-json", "cursor-stream-json", "gemini-stream-json"]).default("text"),
  /** Present → can be opened as a TUI in the integrated terminal. */
  interactiveArgs: z.array(z.string().max(200)).max(20).optional(),
  install: z.string().max(400).optional(),
  login: z.string().max(400).optional(),
});

/** Workbench color tokens a theme may set (see globals.css). */
export const THEME_TOKENS = [
  "bg", "bg-editor", "bg-side", "bg-activity", "bg-panel", "bg-elev", "bg-hover", "bg-active", "bg-input", "bg-title",
  "border", "fg", "fg-muted", "fg-faint", "accent", "accent-fg", "ok", "warn", "err", "status", "status-fg", "shadow", "selection",
] as const;
const COLOR = z.string().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/, "color must be #hex or rgb()/rgba()");

/** A color theme (like VS Code themes): `kind` picks the base (light/dark) it overrides. */
export const ThemeContribution = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,60}$/),
  label: z.string().min(1).max(60),
  kind: z.enum(["dark", "light"]),
  colors: z.partialRecord(z.enum(THEME_TOKENS), COLOR),
});

export const PluginManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(80),
  version: z.string().max(20).default("0.0.0"),
  description: z.string().max(500).default(""),
  author: z.string().max(80).default(""),
  icon: z.string().max(40).default("Puzzle"),
  categories: z.array(z.string().max(30)).max(8).default([]),
  homepage: z.string().max(300).optional(),
  /** Relative path to an ESM module exporting `activate(api)` (see media/providers.ts). */
  main: z.string().max(200).optional(),
  contributes: z
    .object({
      departments: z.array(DepartmentContribution).max(20).default([]),
      commands: z.array(CommandContribution).max(100).default([]),
      mcpServers: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), McpServerContribution).default({}),
      settings: z.array(SettingContribution).max(30).default([]),
      pipelines: z.array(PipelineContribution).max(40).default([]),
      agents: z.array(AgentContribution).max(10).default([]),
      connections: z.array(ConnectionContribution).max(20).default([]),
      themes: z.array(ThemeContribution).max(20).default([]),
    })
    .default({ departments: [], commands: [], mcpServers: {}, settings: [], pipelines: [], agents: [], connections: [], themes: [] }),
});

export type PluginManifest = z.infer<typeof PluginManifest>;
export type DepartmentContribution = z.infer<typeof DepartmentContribution>;
export type CommandContribution = z.infer<typeof CommandContribution>;
export type PipelineContribution = z.infer<typeof PipelineContribution>;
export type AgentContribution = z.infer<typeof AgentContribution>;
export type ConnectionContribution = z.infer<typeof ConnectionContribution>;
export type ThemeContribution = z.infer<typeof ThemeContribution>;

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** Code plugins require explicit trust before `main` is executed. */
  trusted: boolean;
  hasCode: boolean;
  source: string;
  installedAt: number;
  error?: string;
  /** Settings keys that are set (values are never sent to the client). */
  configured: string[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  categories: string[];
  hasCode: boolean;
  /** "builtin:<dir>" | git URL */
  source: string;
  installed?: boolean;
  registry?: string;
}

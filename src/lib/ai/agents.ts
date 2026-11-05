import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { allAgentContributions } from "../plugins/registry";
import { codexMcpArgs, persistentClaudeMcpConfig, type McpServer } from "./mcp";
import type { AgentContribution } from "../plugins/types";
import { getSetting, setSetting } from "../repo";
import type { AgentPrefs, ProviderId, ProviderStatus } from "../types";

const execFileAsync = promisify(execFile);

/**
 * Every AI agent in REX is a terminal CLI that uses its own login — there are
 * no API keys. Claude Code and Codex are built in (with MCP passthrough);
 * extensions contribute more (Cursor Agent, Gemini CLI, Ollama, …) as
 * declarative `agents` in rex-plugin.json.
 */
export type AgentSpec = AgentContribution & { builtin: boolean; pluginId: string | null; mcp: boolean; canEdit: boolean };

const BUILTIN: AgentSpec[] = [
  {
    id: "claude-cli",
    name: "Claude Code",
    description: "Anthropic's coding agent CLI. Reads, edits and runs code in your repo; receives extension MCP tools.",
    icon: "Sparkles",
    homepage: "https://docs.claude.com/en/docs/claude-code",
    command: "claude",
    versionArgs: ["--version"],
    args: [],
    readOnlyArgs: [],
    editArgs: [],
    modelArgs: ["--model", "{model}"],
    models: ["opus", "sonnet", "haiku"],
    prompt: "stdin",
    output: "claude-stream-json",
    interactiveArgs: [],
    install: "npm install -g @anthropic-ai/claude-code",
    login: "claude /login",
    builtin: true,
    pluginId: null,
    mcp: true,
    canEdit: true,
  },
  {
    id: "codex-cli",
    name: "Codex",
    description: "OpenAI's coding agent CLI. Sandboxed read-only or workspace-write runs in your repo; receives extension MCP tools.",
    icon: "Terminal",
    homepage: "https://github.com/openai/codex",
    command: "codex",
    versionArgs: ["--version"],
    args: [],
    readOnlyArgs: [],
    editArgs: [],
    modelArgs: ["-m", "{model}"],
    models: [],
    prompt: "stdin",
    output: "codex-json",
    interactiveArgs: [],
    install: "npm install -g @openai/codex",
    login: "codex login",
    builtin: true,
    pluginId: null,
    mcp: true,
    canEdit: true,
  },
];

// ---------------------------------------------------------------------------
// Sign-in failures. CLI status commands can claim "logged in" while the token
// is dead (e.g. Codex refresh failures), so real runs are the source of truth.
// ---------------------------------------------------------------------------

const ga = globalThis as unknown as { __rexAuthFail?: Map<string, { at: number; message: string }> };
const authFailures: Map<string, { at: number; message: string }> = (ga.__rexAuthFail ??= new Map());
const AUTH_FAIL_TTL = 6 * 60 * 60_000;

export const AUTH_ERROR = /authenticat|not logged in|log ?in first|sign in again|log out and sign in|please (run )?\S*\s*login|unauthori[sz]ed|\b401\b|token (has )?expired|could not be refreshed|invalid api key/i;

export function markAuthFailure(id: string, message: string) {
  authFailures.set(id, { at: Date.now(), message });
}
export function clearAuthFailure(id: string) {
  authFailures.delete(id);
}
export function authFailure(id: string): string | null {
  const f = authFailures.get(id);
  if (!f) return null;
  if (Date.now() - f.at > AUTH_FAIL_TTL) {
    authFailures.delete(id);
    return null;
  }
  return f.message;
}

export function listAgentSpecs(): AgentSpec[] {
  const out = [...BUILTIN];
  for (const a of allAgentContributions()) {
    if (out.some((x) => x.id === a.id)) continue; // built-ins win; first plugin wins
    out.push({ ...a, builtin: false, pluginId: a.pluginId, mcp: false, canEdit: a.editArgs.length > 0 });
  }
  return out;
}

export function getAgentSpec(id: ProviderId): AgentSpec | undefined {
  return listAgentSpecs().find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Availability (cached briefly: `--version` on every request is slow)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rexAgentProbe?: Map<string, { at: number; version: string | null; models: string[] }> };
const probeCache: Map<string, { at: number; version: string | null; models: string[] }> = (g.__rexAgentProbe ??= new Map());
const PROBE_TTL = 60_000;

async function probe(spec: AgentSpec, force: boolean) {
  const key = `${spec.id}:${spec.command}`;
  const hit = probeCache.get(key);
  if (hit && !force && Date.now() - hit.at < PROBE_TTL) return hit;
  let version: string | null = null;
  try {
    const { stdout, stderr } = await execFileAsync(spec.command, spec.versionArgs, { timeout: 8000 });
    version = (stdout.trim() || stderr.trim()).split("\n")[0]?.slice(0, 120) || "installed";
  } catch (e) {
    // Some CLIs exit non-zero for --version but still print it.
    const err = e as { code?: unknown; stdout?: string };
    if (err.code !== "ENOENT" && typeof err.stdout === "string" && err.stdout.trim()) version = err.stdout.trim().split("\n")[0].slice(0, 120);
  }
  let models = spec.models;
  if (version && spec.listModels) {
    try {
      const { stdout } = await execFileAsync(spec.command, spec.listModels.args, { timeout: 8000 });
      const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const found = (spec.listModels.skipHeader ? lines.slice(1) : lines).map((l) => l.split(/\s+/)[0]).filter(Boolean);
      if (found.length) models = [...new Set([...found, ...spec.models])];
    } catch {
      /* keep declared models */
    }
  }
  const res = { at: Date.now(), version, models };
  probeCache.set(key, res);
  return res;
}

export async function agentStatuses(force = false): Promise<ProviderStatus[]> {
  const specs = listAgentSpecs();
  const probes = await Promise.all(specs.map((s) => probe(s, force)));
  return specs.map((s, i) => ({
    id: s.id,
    label: s.name,
    description: s.description,
    icon: s.icon,
    available: Boolean(probes[i].version),
    authError: authFailure(s.id),
    detail: probes[i].version ?? `\`${s.command}\` not found on PATH${s.install ? " — install it from Settings → Agents" : ""}`,
    builtin: s.builtin,
    pluginId: s.pluginId,
    models: probes[i].models,
    install: s.install ?? null,
    login: s.login ?? null,
    interactive: Array.isArray(s.interactiveArgs),
    canEdit: s.canEdit,
    mcp: s.mcp,
    homepage: s.homepage ?? null,
  }));
}

export async function isAgentAvailable(id: ProviderId): Promise<boolean> {
  const spec = getAgentSpec(id);
  return spec ? Boolean((await probe(spec, false)).version) : false;
}

/** Installed and not known to have a dead sign-in. */
export async function isAgentUsable(id: ProviderId): Promise<boolean> {
  return !authFailure(id) && (await isAgentAvailable(id));
}

// ---------------------------------------------------------------------------
// Preferences: which agent each department uses
// ---------------------------------------------------------------------------

const PREFS_KEY = "agents:prefs";
const DEFAULT_PREFS: AgentPrefs = { defaultAgent: "claude-cli", departments: {}, models: {} };

export function getAgentPrefs(): AgentPrefs {
  try {
    const raw = getSetting(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<AgentPrefs>;
    return { defaultAgent: v.defaultAgent || DEFAULT_PREFS.defaultAgent, departments: v.departments ?? {}, models: v.models ?? {} };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setAgentPrefs(p: AgentPrefs): AgentPrefs {
  const clean: AgentPrefs = {
    defaultAgent: p.defaultAgent,
    departments: Object.fromEntries(Object.entries(p.departments).filter(([, v]) => v)),
    models: Object.fromEntries(Object.entries(p.models).filter(([, v]) => v)),
  };
  setSetting(PREFS_KEY, JSON.stringify(clean));
  return clean;
}

/**
 * The agent a run should use: explicit request → user's per-department choice
 * → department default → global default → first installed agent.
 */
export async function resolveAgent(department: { id: string; defaultProvider: string }, requested?: ProviderId | null, exclude: ProviderId[] = []): Promise<ProviderId> {
  const prefs = getAgentPrefs();
  const candidates = [requested, prefs.departments[department.id], department.defaultProvider, prefs.defaultAgent].filter((x): x is string => !!x && !exclude.includes(x));
  // An explicit choice is honoured as long as the CLI is installed (its sign-in error is shown if it fails).
  if (requested && !exclude.includes(requested) && getAgentSpec(requested) && (await isAgentAvailable(requested))) return requested;
  for (const c of candidates) if (getAgentSpec(c) && (await isAgentUsable(c))) return c;
  for (const s of listAgentSpecs()) if (!exclude.includes(s.id) && (await isAgentUsable(s.id))) return s.id;
  return candidates[0] ?? "claude-cli";
}

// ---------------------------------------------------------------------------
// Integrated-terminal command lines (install / sign in / interactive session)
// ---------------------------------------------------------------------------

/** The model to use when none was chosen for this run: user preference, else first known model (needed when args reference {model}). */
export function defaultModel(spec: AgentSpec): string {
  const pref = getAgentPrefs().models[spec.id];
  if (pref) return pref;
  const needsModel = [...spec.args, ...(spec.interactiveArgs ?? [])].some((a) => a.includes("{model}"));
  if (!needsModel) return "";
  return probeCache.get(`${spec.id}:${spec.command}`)?.models[0] ?? spec.models[0] ?? "";
}

/** Substitutes {model}, {cwd} and {prompt} placeholders. */
export function fillArgs(args: string[], v: { model?: string; cwd?: string; prompt?: string }): string[] {
  return args.map((a) => a.replaceAll("{model}", v.model ?? "").replaceAll("{cwd}", v.cwd ?? "").replaceAll("{prompt}", v.prompt ?? ""));
}

function shq(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export type TerminalAction = "install" | "login" | "interactive";

/** Shell line to type into the integrated terminal, or null when the agent doesn't support the action. */
export function terminalCommand(
  id: ProviderId,
  action: TerminalAction,
  opts: { model?: string; system?: string; session?: { id: string | null; resume: boolean }; mcp?: { key: string; servers: McpServer[] }; initialPrompt?: string } = {},
): string | null {
  const spec = getAgentSpec(id);
  if (!spec) return null;
  if (action === "install") return spec.install ?? null;
  if (action === "login") return spec.login ?? null;
  if (!spec.interactiveArgs) return null;
  const model = opts.model || defaultModel(spec);
  const args = fillArgs(spec.interactiveArgs, { model });
  // Shared panel ⇄ terminal session (see ai/sessions.ts).
  const sid = opts.session?.id;
  if (sid && spec.id === "claude-cli") args.push(opts.session!.resume ? "--resume" : "--session-id", sid);
  if (sid && spec.id === "codex-cli" && opts.session!.resume) args.unshift("resume", sid);
  // Extension / connection tools (Figma, Search Console, …) in interactive sessions too.
  if (opts.mcp?.servers.length && spec.id === "claude-cli") args.push("--mcp-config", persistentClaudeMcpConfig(opts.mcp.key, opts.mcp.servers));
  if (opts.mcp?.servers.length && spec.id === "codex-cli") args.unshift(...codexMcpArgs(opts.mcp.servers));
  if (model && spec.modelArgs.length) args.push(...fillArgs(spec.modelArgs, { model }));
  // Initial prompt goes first: variadic flags such as --mcp-config would swallow it.
  let line = [spec.command, ...(opts.initialPrompt ? [opts.initialPrompt] : []), ...args].map(shq).join(" ");
  // Claude Code takes the department role for the whole interactive session.
  // The role goes through a private temp file so the typed command stays short.
  if (opts.system && spec.id === "claude-cli") {
    const file = path.join(os.tmpdir(), `rex-role-${randomUUID()}.md`);
    fs.writeFileSync(file, opts.system, { mode: 0o600 });
    line += ` --append-system-prompt "$(cat ${shq(file)}; rm -f ${shq(file)})"`; // read once, then removed
  }
  return line;
}

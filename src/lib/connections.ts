import "server-only";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./agentEnv";
import { accessToken, oauthStatus } from "./oauth/mcpOAuth";
import { allConnectionContributions, allMcpServers, catalogManifests, getPluginSetting, listInstalled, readyMcpServers, REX_BIN, type ResolvedMcpServer } from "./plugins/registry";
import type { McpServer } from "./ai/mcp";
import type { PluginManifest } from "./plugins/types";
import type { ConnectionInfo, ConnectionStatus } from "./types";
export type { ConnectionInfo, ConnectionStatus } from "./types";
import { getSetting, setSetting } from "./repo";

/**
 * Third-party connections (Google Search Console, Analytics, Figma, Canva,
 * Premiere Pro, After Effects, …). Each comes from an extension:
 * - `mcp` connections give the department's terminal agents the service's
 *   tools (MCP). Sign-in is the provider's own flow: the agent's OAuth
 *   (`/mcp`) or a CLI login in the integrated terminal. No keys pasted in REX.
 * - `app` connections drive a desktop app on this Mac (open media, export
 *   editable projects).
 */

const STATE_KEY = "connections:state";
type State = Record<string, { connectedAt?: number }>;

function readState(): State {
  try {
    return JSON.parse(getSetting(STATE_KEY) || "{}") as State;
  } catch {
    return {};
  }
}

export function markConnection(id: string, connected: boolean) {
  const s = readState();
  if (connected) s[id] = { ...s[id], connectedAt: Date.now() };
  else delete s[id];
  setSetting(STATE_KEY, JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// Desktop apps (macOS): /Applications/<Name>.app or /Applications/<Name>/<Name>.app
// ---------------------------------------------------------------------------

const APP_ROOTS = ["/Applications", path.join(process.env.HOME ?? "", "Applications")];

export function findApp(prefixes: string[]): string | null {
  for (const root of APP_ROOTS) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(/*turbopackIgnore: true*/ root);
    } catch {
      continue;
    }
    // Newest versions sort last ("Adobe Premiere Pro 2025" > "… 2024").
    for (const prefix of prefixes) {
      const hits = entries.filter((e) => e.startsWith(prefix)).sort().reverse();
      for (const hit of hits) {
        const p = path.join(/*turbopackIgnore: true*/ root, hit);
        if (hit.endsWith(".app")) return p;
        try {
          const inner = fs.readdirSync(/*turbopackIgnore: true*/ p).find((f) => f.startsWith(prefix) && f.endsWith(".app"));
          if (inner) return path.join(/*turbopackIgnore: true*/ p, inner);
        } catch {
          /* not a folder */
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sign-in checks (terminal auth), cached briefly
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rexConnCheck?: Map<string, { at: number; ok: boolean }> };
const checks: Map<string, { at: number; ok: boolean }> = (g.__rexConnCheck ??= new Map());

function runCheck(command: string, force: boolean): Promise<boolean> {
  const hit = checks.get(command);
  if (hit && !force && Date.now() - hit.at < 60_000) return Promise.resolve(hit.ok);
  return new Promise((resolve) => {
    exec(command, { timeout: 10_000, env: agentEnv(), shell: process.env.SHELL || "/bin/zsh" }, (err) => {
      const ok = !err;
      checks.set(command, { at: Date.now(), ok });
      resolve(ok);
    });
  });
}

// ---------------------------------------------------------------------------

export async function listConnections(force = false): Promise<ConnectionInfo[]> {
  const installed = new Map(listInstalled().map((p) => [p.manifest.id, p]));
  const servers = allMcpServers();
  const state = readState();
  const out: ConnectionInfo[] = [];
  const seen = new Set<string>();

  const sources: { manifest: PluginManifest; source: string | null }[] = [
    ...[...installed.values()].map((p) => ({ manifest: p.manifest, source: null })),
    ...catalogManifests().filter((c) => !installed.has(c.manifest.id)),
  ];

  for (const { manifest, source } of sources) {
    const plugin = installed.get(manifest.id);
    for (const c of manifest.contributes.connections) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const settings = manifest.contributes.settings.map((st) => ({
        key: st.key,
        title: st.title,
        description: st.description,
        secret: st.secret,
        configured: plugin ? !!getPluginSetting(manifest.id, st.key) : false,
      }));
      const appPath = c.kind === "app" ? findApp(c.apps) : null;
      let status: ConnectionStatus;
      let detail: string;
      if (!plugin) {
        status = "available";
        detail = "Install to connect";
      } else if (!plugin.enabled) {
        status = "disabled";
        detail = "Extension is disabled";
      } else if (c.kind === "app") {
        status = appPath ? "connected" : "app-missing";
        detail = appPath ? appPath : `${c.apps[0] ?? c.name} isn't installed in /Applications`;
      } else {
        const srv = servers.find((s) => s.pluginId === manifest.id && s.name === c.mcpServer);
        if (srv?.missing.length) {
          status = "needs-setup";
          detail = `Set ${srv.missing.join(", ")} in the connection settings`;
        } else if (c.auth === "oauth") {
          const o = oauthStatus(c.id);
          status = o.connected ? "connected" : "needs-auth";
          detail = o.connected ? "Signed in through your browser" : "Connect to sign in through your browser";
        } else if ((c.auth === "terminal" || c.auth === "browser-cli") && c.checkCommand) {
          const ok = await runCheck(withRexBin(c.checkCommand), force);
          status = ok ? "connected" : "needs-auth";
          detail = ok ? "Signed in" : c.auth === "browser-cli" ? "Connect to sign in through your browser" : "Sign in from the terminal";
        } else if (c.auth === "agent-oauth") {
          const at = state[c.id]?.connectedAt;
          status = at ? "connected" : "needs-auth";
          detail = at ? "Authorized through the agent's sign-in" : "Authorize once through the agent (opens the provider's sign-in page)";
        } else {
          status = "connected";
          detail = "Ready";
        }
      }
      out.push({
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        category: c.category,
        departments: c.departments,
        kind: c.kind,
        auth: c.auth,
        authCommand: c.authCommand ?? null,
        actions: c.actions,
        docs: c.docs ?? null,
        setupHint: c.setupHint,
        pluginId: manifest.id,
        source,
        installed: !!plugin,
        status,
        statusDetail: detail,
        settings,
        appPath,
        connectedAt: state[c.id]?.connectedAt ?? null,
      });
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export async function getConnection(id: string): Promise<ConnectionInfo | undefined> {
  return (await listConnections()).find((c) => c.id === id);
}

/** The MCP server a connection exposes, resolved from its (enabled) extension. */
export function connectionServer(c: ConnectionInfo) {
  if (c.kind !== "mcp") return undefined;
  const manifest = listInstalled().find((p) => p.manifest.id === c.pluginId)?.manifest;
  const name = manifest?.contributes.connections.find((x) => x.id === c.id)?.mcpServer;
  return allMcpServers().find((s) => s.pluginId === c.pluginId && s.name === name);
}

export const withRexBin = (cmd: string) => cmd.replaceAll("${rex:bin}", REX_BIN);

/** Forget cached sign-in checks (after a login finishes). */
export function clearConnectionChecks() {
  checks.clear();
}

const gt = globalThis as unknown as { __rexTokenCmd?: Map<string, { at: number; token: string | null }> };
const tokenCache: Map<string, { at: number; token: string | null }> = (gt.__rexTokenCmd ??= new Map());

function runTokenCommand(command: string): Promise<string | null> {
  const hit = tokenCache.get(command);
  if (hit && Date.now() - hit.at < 5 * 60_000) return Promise.resolve(hit.token);
  return new Promise((resolve) => {
    exec(command, { timeout: 10_000, env: agentEnv(), shell: process.env.SHELL || "/bin/zsh" }, (err, stdout) => {
      const token = err ? null : stdout.trim().split("\n")[0] || null;
      tokenCache.set(command, { at: Date.now(), token });
      resolve(token);
    });
  });
}

/**
 * MCP servers for a department's agent run, with sign-ins attached: REX OAuth
 * tokens / CLI tokens become Authorization headers. Remote servers that need a
 * sign-in the user hasn't done are left out (instead of failing the run).
 */
export async function agentMcpServers(department?: string): Promise<McpServer[]> {
  const servers: ResolvedMcpServer[] = readyMcpServers(department);
  const conns = allConnectionContributions();
  const out: McpServer[] = [];
  for (const s of servers) {
    const c = conns.find((x) => x.pluginId === s.pluginId && x.mcpServer === s.name);
    if (c?.auth === "oauth") {
      const token = await accessToken(c.id);
      if (!token) continue;
      out.push({ ...s, headers: { Authorization: `Bearer ${token}` } });
    } else if (c?.tokenCommand) {
      const token = await runTokenCommand(withRexBin(c.tokenCommand));
      if (!token) continue;
      out.push({ ...s, headers: { Authorization: `Bearer ${token}` } });
    } else out.push(s);
  }
  return out;
}

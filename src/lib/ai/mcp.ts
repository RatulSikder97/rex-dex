import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db";

/** An MCP server handed to a terminal agent (from an extension / connection). */
export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Remote server (connections such as Figma, Canva, Notion); auth via the agent's OAuth. */
  url?: string;
  transport?: "stdio" | "http" | "sse";
  /** Remote servers: request headers (e.g. Authorization from REX's OAuth sign-in). */
  headers?: Record<string, string>;
}

/** Claude Code `mcpServers` JSON for these servers (stdio or remote). */
export function claudeMcpJson(servers: McpServer[]): string {
  const mcpServers = Object.fromEntries(
    servers.map((s) => [s.name, s.url ? { type: s.transport === "sse" ? "sse" : "http", url: s.url, ...(s.headers ? { headers: s.headers } : {}) } : { command: s.command, args: s.args, env: s.env }]),
  );
  return JSON.stringify({ mcpServers });
}

/** TOML literal for codex `-c key=value` overrides. */
export function toml(v: unknown): string {
  return JSON.stringify(v);
}

/** Codex `-c mcp_servers.*` overrides for these servers. */
export function codexMcpArgs(servers: McpServer[]): string[] {
  const args: string[] = [];
  for (const s of servers) {
    if (s.url) {
      args.push("-c", `mcp_servers.${s.name}.url=${toml(s.url)}`);
      for (const [k, v] of Object.entries(s.headers ?? {})) args.push("-c", `mcp_servers.${s.name}.http_headers.${k}=${toml(v)}`);
      continue;
    }
    args.push("-c", `mcp_servers.${s.name}.command=${toml(s.command)}`, "-c", `mcp_servers.${s.name}.args=${toml(s.args)}`);
    for (const [k, v] of Object.entries(s.env)) args.push("-c", `mcp_servers.${s.name}.env.${k}=${toml(v)}`);
  }
  return args;
}

/**
 * Stable, private `--mcp-config` file for interactive sessions (the terminal
 * outlives any temp file). Same server names/URLs every time, so OAuth sign-ins
 * done with `/mcp` carry over to later runs.
 */
export function persistentClaudeMcpConfig(key: string, servers: McpServer[]): string {
  const dir = path.join(DATA_DIR, "mcp");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);
  fs.writeFileSync(file, claudeMcpJson(servers), { mode: 0o600 });
  return file;
}

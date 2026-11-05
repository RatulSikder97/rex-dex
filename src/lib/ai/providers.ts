import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { agentEnv } from "../agentEnv";
import { claudeMcpJson, codexMcpArgs, toml, type McpServer } from "./mcp";
export type { McpServer } from "./mcp";
import type { ProviderId } from "../types";
import { defaultModel, fillArgs, getAgentSpec, type AgentSpec } from "./agents";

/**
 * Runs a terminal AI agent non-interactively and streams its text. Every
 * agent is a local CLI with its own login — REX never holds API keys.
 */
export interface ProviderRequest {
  provider: ProviderId;
  system: string;
  prompt: string;
  /** Model override; otherwise the user's preference for this agent. */
  model?: string;
  /** Working directory for the agent (the project repo). */
  cwd?: string;
  /** Allow file edits in `cwd`. */
  allowEdits?: boolean;
  /** MCP servers contributed by enabled plugins (agents that support MCP). */
  mcpServers?: McpServer[];
  /**
   * Agent-native session to continue (Claude Code / Codex), shared with the
   * integrated terminal. `id` null on Codex = start fresh and report the id.
   */
  session?: { id: string | null; resume: boolean };
  onSession?: (id: string) => void;
  signal: AbortSignal;
  onChunk: (text: string) => void;
}

export class ProviderError extends Error {}

/** Writes a Claude Code `--mcp-config` file; returns its path (caller deletes). */
function writeClaudeMcpConfig(servers: McpServer[]): string {
  const file = path.join(os.tmpdir(), `rex-mcp-${randomUUID()}.json`);
  fs.writeFileSync(file, claudeMcpJson(servers), { mode: 0o600 });
  return file;
}


export async function runProvider(req: ProviderRequest): Promise<void> {
  const spec = getAgentSpec(req.provider);
  if (!spec) throw new ProviderError(`Unknown agent "${req.provider}". Install its extension or pick another agent.`);
  const model = req.model || defaultModel(spec);
  if (spec.id === "claude-cli") return runClaudeCli(req, model);
  if (spec.id === "codex-cli") return runCodexCli(req, model);
  return runGeneric(spec, req, model);
}

// ---------------------------------------------------------------------------
// CLI agents
// ---------------------------------------------------------------------------

function resolveCwd(cwd?: string): string {
  if (cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) return cwd;
  return process.cwd();
}

/**
 * Spawns a CLI, feeds `stdin`, and hands each complete stdout line to `onLine`.
 * Rejects on non-zero exit with the tail of stderr.
 */
function spawnLines(
  cmd: string,
  args: string[],
  opts: { cwd: string; stdin: string; signal: AbortSignal; onLine: (line: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: agentEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const onAbort = () => child.kill("SIGTERM");
    opts.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      buf += data;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) opts.onLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on("error", (err) => {
      opts.signal.removeEventListener("abort", onAbort);
      reject(new ProviderError(`Failed to start ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      opts.signal.removeEventListener("abort", onAbort);
      if (buf.trim()) opts.onLine(buf.trim());
      if (opts.signal.aborted) return reject(new ProviderError("Cancelled"));
      if (code === 0) resolve();
      else reject(new ProviderError(`${cmd} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
    child.stdin.end(opts.stdin);
  });
}

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const v = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description;
  return typeof v === "string" ? v.slice(0, 160) : "";
}

async function runClaudeCli(req: ProviderRequest, model: string): Promise<void> {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--append-system-prompt",
    req.system,
    "--permission-mode",
    req.allowEdits ? "acceptEdits" : "default",
  ];
  if (model) args.push("--model", model);
  if (req.session?.id) args.push(req.session.resume ? "--resume" : "--session-id", req.session.id);
  if (!req.allowEdits) args.push("--disallowedTools", "Edit", "Write", "NotebookEdit");
  let mcpFile: string | null = null;
  if (req.mcpServers?.length) {
    mcpFile = writeClaudeMcpConfig(req.mcpServers);
    args.push("--mcp-config", mcpFile, "--allowedTools", ...req.mcpServers.map((s) => `mcp__${s.name}`));
  }

  let streamedText = false;
  let resultText = "";
  let failure: string | null = null;

  try {
    await spawnLines("claude", args, {
      cwd: resolveCwd(req.cwd),
      stdin: req.prompt,
      signal: req.signal,
      onLine: (line) => {
        const ev = parseJson(line);
        if (!ev) return;
        if (ev.type === "stream_event") {
          const inner = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
          if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
            streamedText = true;
            req.onChunk(inner.delta.text);
          }
          if (inner?.type === "message_stop" && streamedText) req.onChunk("\n\n");
        } else if (ev.type === "assistant") {
          const content = (ev.message as { content?: Array<{ type: string; name?: string; input?: unknown }> })?.content ?? [];
          for (const block of content) {
            if (block.type === "tool_use") {
              const detail = summarizeToolInput(block.input);
              req.onChunk(`\n> 🔧 **${block.name}**${detail ? ` \`${detail.replace(/`/g, "'")}\`` : ""}\n\n`);
            }
          }
        } else if (ev.type === "result") {
          resultText = typeof ev.result === "string" ? ev.result : "";
          if (ev.is_error) failure = resultText || "Claude Code reported an error";
        }
      },
    });
  } finally {
    if (mcpFile) fs.rmSync(mcpFile, { force: true });
  }

  if (failure) throw new ProviderError(failure);
  if (!streamedText && resultText) req.onChunk(resultText);
}

async function runCodexCli(req: ProviderRequest, model: string): Promise<void> {
  const cwd = resolveCwd(req.cwd);
  const sandbox = req.allowEdits ? "workspace-write" : "read-only";
  const resumeId = req.session?.resume ? req.session.id : null;
  // `exec resume` has no -C/-s flags: cwd comes from the process, sandbox from config.
  const args = resumeId
    ? ["exec", "resume", "--skip-git-repo-check", "--json", "-c", `sandbox_mode=${toml(sandbox)}`]
    : ["exec", "--skip-git-repo-check", "-C", cwd, "-s", sandbox, "--json"];
  if (model) args.push("-m", model);
  args.push(...codexMcpArgs(req.mcpServers ?? []));
  if (resumeId) args.push(resumeId);
  args.push("-");
  const prompt = `<role>\n${req.system}\n</role>\n\n${req.prompt}`;
  let failure: string | null = null;

  await spawnLines("codex", args, {
    cwd,
    stdin: prompt,
    signal: req.signal,
    onLine: (line) => {
      const ev = parseJson(line);
      if (!ev) return;
      const type = ev.type as string | undefined;
      if (type === "thread.started" && typeof ev.thread_id === "string") req.onSession?.(ev.thread_id);
      if (type === "item.completed" || type === "item.started") {
        const item = ev.item as { type?: string; text?: string; command?: string; changes?: Array<{ path?: string; kind?: string }> };
        if (type === "item.completed" && item?.type === "agent_message" && item.text) {
          req.onChunk(item.text + "\n\n");
        } else if (type === "item.started" && item?.type === "command_execution" && item.command) {
          req.onChunk(`> 🔧 \`${item.command.slice(0, 200).replace(/`/g, "'")}\`\n\n`);
        } else if (type === "item.completed" && item?.type === "file_change" && item.changes?.length) {
          req.onChunk(item.changes.map((c) => `> ✏️ ${c.kind ?? "edit"} \`${c.path}\``).join("\n") + "\n\n");
        }
      } else if (type === "turn.failed") {
        failure = (ev.error as { message?: string })?.message ?? "Codex turn failed";
      } else if (type === "error" && !failure) {
        failure = (ev.message as string) ?? "Codex error";
      }
    },
  });

  if (failure) throw new ProviderError(failure);
}

// ---------------------------------------------------------------------------
// Extension-contributed agents (declarative spec)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r(?!\n)/g;

function spawnRaw(cmd: string, args: string[], opts: { cwd: string; stdin: string | null; signal: AbortSignal; onData: (s: string) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: agentEnv({ NO_COLOR: "1", TERM: "dumb" }), stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const onAbort = () => child.kill("SIGTERM");
    opts.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => opts.onData(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on("error", (err) => {
      opts.signal.removeEventListener("abort", onAbort);
      reject(new ProviderError(`Failed to start ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      opts.signal.removeEventListener("abort", onAbort);
      if (opts.signal.aborted) return reject(new ProviderError("Cancelled"));
      if (code === 0) resolve();
      else reject(new ProviderError(`${cmd} exited with code ${code}${stderr ? `: ${stderr.replace(ANSI, "").trim()}` : ""}`));
    });
    if (opts.stdin === null) child.stdin.end();
    else child.stdin.end(opts.stdin);
  });
}

async function runGeneric(spec: AgentSpec, req: ProviderRequest, model: string): Promise<void> {
  const cwd = resolveCwd(req.cwd);
  const prompt = `<role>\n${req.system}\n</role>\n\n${req.prompt}`;
  const viaArg = spec.prompt === "arg";
  const args = fillArgs(spec.args, { model, cwd, prompt: viaArg ? prompt : "" });
  args.push(...(req.allowEdits && spec.editArgs.length ? spec.editArgs : spec.readOnlyArgs));
  if (model && spec.modelArgs.length && !spec.args.some((a) => a.includes("{model}"))) args.push(...fillArgs(spec.modelArgs, { model }));
  const stdin = viaArg ? null : prompt;

  if (spec.output === "text") {
    await spawnRaw(spec.command, args, { cwd, stdin, signal: req.signal, onData: (d) => req.onChunk(d.replace(ANSI, "")) });
    return;
  }

  let failure: string | null = null;
  let streamed = false;
  let resultText = "";
  const onLine = (line: string) => {
    const ev = parseJson(line);
    if (!ev) return;
    if (spec.output === "claude-stream-json" || spec.output === "cursor-stream-json") {
      // Cursor Agent's stream-json mirrors Claude Code's envelope.
      if (ev.type === "assistant") {
        const content = (ev.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> })?.content ?? [];
        for (const b of content) {
          if (b.type === "text" && b.text) {
            streamed = true;
            req.onChunk(b.text);
          } else if (b.type === "tool_use") req.onChunk(`\n> 🔧 **${b.name}** ${summarizeToolInput(b.input)}\n\n`);
        }
      } else if (ev.type === "tool_call" && ev.subtype === "started") {
        const call = (ev.tool_call ?? {}) as Record<string, { args?: unknown }>;
        const [name, body] = Object.entries(call)[0] ?? ["tool", {}];
        const detail = summarizeToolInput(body?.args);
        req.onChunk(`\n> 🔧 **${name.replace(/ToolCall$/, "")}**${detail ? ` \`${detail.replace(/`/g, "'")}\`` : ""}\n\n`);
      } else if (ev.type === "result") {
        resultText = typeof ev.result === "string" ? ev.result : "";
        if (ev.is_error) failure = resultText || `${spec.name} reported an error`;
      }
    } else if (spec.output === "gemini-stream-json") {
      if (ev.type === "message" && ev.role === "assistant" && typeof ev.content === "string") {
        streamed = true;
        req.onChunk(ev.content);
      } else if (ev.type === "tool_use") {
        const detail = summarizeToolInput(ev.parameters);
        req.onChunk(`\n> 🔧 **${String(ev.tool_name)}**${detail ? ` \`${detail.replace(/`/g, "'")}\`` : ""}\n\n`);
      } else if (ev.type === "error") {
        failure = String((ev as { message?: unknown }).message ?? "error");
      } else if (ev.type === "result" && ev.status === "error") {
        failure = (ev.error as { message?: string } | undefined)?.message ?? `${spec.name} failed`;
      }
    } else if (spec.output === "codex-json") {
      if (ev.type === "item.completed") {
        const item = ev.item as { type?: string; text?: string };
        if (item?.type === "agent_message" && item.text) req.onChunk(item.text + "\n\n");
      } else if (ev.type === "turn.failed") failure = (ev.error as { message?: string })?.message ?? "turn failed";
    }
  };
  let buf = "";
  await spawnRaw(spec.command, args, {
    cwd,
    stdin,
    signal: req.signal,
    onData: (d) => {
      buf += d;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onLine(line);
      }
    },
  });
  if (buf.trim()) onLine(buf.trim());
  if (failure) throw new ProviderError(failure);
  if (!streamed && resultText) req.onChunk(resultText);
}

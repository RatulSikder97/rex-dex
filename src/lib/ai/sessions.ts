import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../db";

/**
 * Panel ⇄ terminal sync.
 *
 * An Agent-panel conversation (thread) is bound to the terminal agent's own
 * session: Claude Code (`--session-id` / `--resume`) or Codex (`exec resume`).
 * Headless panel turns and the interactive terminal both continue that one
 * session, and the panel renders the session's own transcript file, so turns
 * typed in the terminal show up in the panel and vice versa.
 */

export const SESSION_AGENTS = ["claude-cli", "codex-cli"] as const;
export const supportsSessions = (agent: string) => (SESSION_AGENTS as readonly string[]).includes(agent);

export interface ThreadSession {
  thread_id: string;
  agent: string;
  session_id: string | null;
  cwd: string;
  terminal_id: string | null;
  updated_at: number;
  department?: string | null;
  project_id?: string | null;
  title?: string | null;
}

export function getThreadSession(threadId: string): ThreadSession | undefined {
  return db().prepare("SELECT * FROM agent_threads WHERE thread_id = ?").get(threadId) as ThreadSession | undefined;
}

export function saveThreadSession(s: Omit<ThreadSession, "updated_at">) {
  db()
    .prepare(
      `INSERT INTO agent_threads (thread_id, agent, session_id, cwd, terminal_id, department, project_id, title, updated_at)
       VALUES (@thread_id, @agent, @session_id, @cwd, @terminal_id, @department, @project_id, @title, @now)
       ON CONFLICT(thread_id) DO UPDATE SET agent = @agent, session_id = @session_id, cwd = @cwd, terminal_id = @terminal_id,
         department = COALESCE(@department, department), project_id = COALESCE(@project_id, project_id), title = COALESCE(@title, title), updated_at = @now`,
    )
    .run({ department: null, project_id: null, title: null, ...s, now: Date.now() });
}

export function setThreadTerminal(threadId: string, terminalId: string | null) {
  db().prepare("UPDATE agent_threads SET terminal_id = ?, updated_at = ? WHERE thread_id = ?").run(terminalId, Date.now(), threadId);
}

export function deleteThreadSession(threadId: string) {
  db().prepare("DELETE FROM agent_threads WHERE thread_id = ?").run(threadId);
}

/**
 * Folder an agent runs in for a project: its repo when linked and present,
 * else the REX folder. Sessions are keyed by folder, so the panel and the
 * terminal must agree on it.
 */
export function agentCwd(repoPath?: string | null): string {
  try {
    if (repoPath && fs.statSync(/*turbopackIgnore: true*/ repoPath).isDirectory()) return repoPath;
  } catch {
    /* missing */
  }
  return process.cwd();
}

/** Session to continue for this thread, or null when a fresh one must start (different agent / folder). */
export function reusableSession(threadId: string, agent: string, cwd: string): string | null {
  const s = getThreadSession(threadId);
  return s && s.agent === agent && s.cwd === cwd && s.session_id ? s.session_id : null;
}

// ---------------------------------------------------------------------------
// Session transcript files
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rexSessionFiles?: Map<string, string> };
const fileCache: Map<string, string> = (g.__rexSessionFiles ??= new Map());

function claudeFile(sessionId: string): string | null {
  const root = path.join(os.homedir(), ".claude", "projects");
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(/*turbopackIgnore: true*/ root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(root, d, `${sessionId}.jsonl`);
    if (fs.existsSync(/*turbopackIgnore: true*/ f)) return f;
  }
  return null;
}

/** Codex keeps sessions under ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl; search newest days first. */
function codexFiles(): { file: string; mtime: number }[] {
  const root = path.join(os.homedir(), ".codex", "sessions");
  const out: { file: string; mtime: number }[] = [];
  const list = (p: string) => {
    try {
      return fs.readdirSync(/*turbopackIgnore: true*/ p).sort().reverse();
    } catch {
      return [];
    }
  };
  let days = 0;
  for (const y of list(root))
    for (const m of list(path.join(root, y)))
      for (const d of list(path.join(root, y, m))) {
        if (++days > 14) return out;
        for (const f of list(path.join(root, y, m, d)))
          if (f.endsWith(".jsonl")) {
            const file = path.join(root, y, m, d, f);
            try {
              out.push({ file, mtime: fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs });
            } catch {
              /* vanished */
            }
          }
      }
  return out;
}

export function sessionFile(agent: string, sessionId: string): string | null {
  const key = `${agent}:${sessionId}`;
  const hit = fileCache.get(key);
  if (hit && fs.existsSync(/*turbopackIgnore: true*/ hit)) return hit;
  const found = agent === "claude-cli" ? claudeFile(sessionId) : agent === "codex-cli" ? (codexFiles().find((f) => f.file.endsWith(`${sessionId}.jsonl`))?.file ?? null) : null;
  if (found) fileCache.set(key, found);
  return found;
}

/**
 * An interactive Codex session started fresh has no id we could choose up
 * front; adopt the newest session recorded in `cwd` since the terminal opened.
 */
export function discoverCodexSession(cwd: string, since: number): string | null {
  for (const { file, mtime } of codexFiles().sort((a, b) => b.mtime - a.mtime)) {
    if (mtime < since) break;
    try {
      const first = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").split("\n", 1)[0];
      const meta = JSON.parse(first) as { type?: string; payload?: { id?: string; cwd?: string; timestamp?: string } };
      if (meta.type === "session_meta" && meta.payload?.cwd === cwd && meta.payload.id && Date.parse(meta.payload.timestamp ?? "") >= since - 5000) return meta.payload.id;
    } catch {
      /* unreadable */
    }
  }
  return null;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
  at: number;
}

const CONTEXT_BLOCK = /<rex-context>[\s\S]*?<\/rex-context>\s*/g;
const ROLE_BLOCK = /^<role>[\s\S]*?<\/role>\s*/;

function cleanUserText(t: string): string | null {
  let s = t.replace(CONTEXT_BLOCK, "").replace(ROLE_BLOCK, "").trim();
  const cmd = s.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return `${cmd[1].trim()}${args ? ` ${args}` : ""}`;
  }
  if (/^<(local-command-stdout|local-command-stderr|environment_context|user_instructions|permissions|system-reminder)/.test(s) || s.startsWith("Caveat:") || s.startsWith("# AGENTS.md")) return null;
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  return s || null;
}

function toolLine(name: string, input: unknown): string {
  let detail = "";
  if (typeof input === "string") detail = input;
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const v = o.command ?? o.cmd ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description ?? o.query;
    detail = typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "";
  }
  detail = detail.replace(/\s+/g, " ").slice(0, 160).replace(/`/g, "'");
  return `\n> 🔧 **${name}**${detail ? ` \`${detail}\`` : ""}\n`;
}

/** Reads a Claude Code / Codex session file into user/assistant turns. */
export function readTranscript(agent: string, sessionId: string): TranscriptTurn[] | null {
  const file = sessionFile(agent, sessionId);
  if (!file) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return null;
  }
  const turns: TranscriptTurn[] = [];
  const push = (role: "user" | "assistant", text: string, at: number) => {
    const last = turns[turns.length - 1];
    if (role === "assistant" && last?.role === "assistant") last.text += text;
    else if (role === "user" || text.trim()) turns.push({ role, text, at });
  };

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(String(o.timestamp ?? "")) || 0;
    if (agent === "claude-cli") {
      if ((o.type !== "user" && o.type !== "assistant") || o.isSidechain || o.isMeta) continue;
      const content = (o.message as { content?: unknown })?.content;
      const blocks: Array<{ type: string; text?: string; name?: string; input?: unknown }> =
        typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      if (o.type === "user") {
        const text = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text!).join("\n");
        const clean = text ? cleanUserText(text) : null;
        if (clean) push("user", clean, at);
      } else {
        for (const b of blocks) {
          if (b.type === "text" && b.text) push("assistant", (turns[turns.length - 1]?.role === "assistant" ? "\n\n" : "") + b.text, at);
          else if (b.type === "tool_use") push("assistant", toolLine(b.name ?? "tool", b.input), at);
        }
      }
    } else if (agent === "codex-cli") {
      if (o.type !== "response_item") continue;
      const p = (o.payload ?? {}) as { type?: string; role?: string; content?: Array<{ type: string; text?: string }>; name?: string; input?: unknown; arguments?: unknown };
      if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
        const text = (p.content ?? []).map((c) => c.text ?? "").join("\n");
        if (p.role === "user") {
          const clean = cleanUserText(text);
          if (clean) push("user", clean, at);
        } else if (text.trim()) push("assistant", (turns[turns.length - 1]?.role === "assistant" ? "\n\n" : "") + text, at);
      } else if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
        let input: unknown = p.input ?? p.arguments;
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch {
            /* keep string */
          }
        }
        push("assistant", toolLine(p.name ?? "shell", input), at);
      }
    }
  }
  return turns;
}

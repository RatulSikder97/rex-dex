import "server-only";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { agentEnv } from "./agentEnv";
import { sessionSecret } from "./sessionSecret";
import { getProject } from "./repo";

const MAX_SCROLLBACK = 200 * 1024;

export type TerminalEvent = { type: "data"; data: string } | { type: "exit"; exitCode: number; signal?: number };

interface Session {
  id: string;
  title: string;
  cwd: string;
  projectId: string | null;
  pty: IPty;
  buffer: string;
  emitter: EventEmitter;
  exited: { exitCode: number; signal?: number } | null;
  createdAt: number;
}

export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  projectId: string | null;
  pid: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

const g = globalThis as unknown as { __rexTerminals?: Map<string, Session>; __rexTerminalSeq?: number };
const sessions: Map<string, Session> = (g.__rexTerminals ??= new Map());

function info(s: Session): TerminalInfo {
  return { id: s.id, title: s.title, cwd: s.cwd, projectId: s.projectId, pid: s.pty.pid, exited: !!s.exited, exitCode: s.exited?.exitCode ?? null, createdAt: s.createdAt };
}

function clampDim(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n) || min));
}

export function listTerminals(): TerminalInfo[] {
  return [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt).map(info);
}

/**
 * `run` is typed into the shell once it starts (like VS Code tasks), so the
 * user keeps a normal shell after the command exits.
 */
export async function createTerminal(opts: { projectId?: string | null; cols: number; rows: number; run?: string; title?: string }): Promise<TerminalInfo> {
  // node-pty is a native module; load lazily so nothing native runs at import time.
  const pty = await import("node-pty");
  const repoPath = opts.projectId ? getProject(opts.projectId)?.repo_path : undefined;
  const cwd = repoPath && fs.existsSync(/*turbopackIgnore: true*/ repoPath) && fs.statSync(/*turbopackIgnore: true*/ repoPath).isDirectory() ? repoPath : process.cwd();
  const shell = process.env.SHELL || "/bin/zsh";
  const env = agentEnv({
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "REX",
    // The `rex` CLI (bin/rex.mjs) is on PATH and knows this server + project.
    PATH: `${path.join(process.cwd(), "bin")}:${process.env.PATH ?? ""}`,
    REX_URL: `http://localhost:${process.env.PORT || 4747}`,
    // Lets the `rex` CLI in this terminal call the local engine (see src/proxy.ts).
    REX_TOKEN: sessionSecret(),
    ...(opts.projectId ? { REX_PROJECT_ID: opts.projectId } : {}),
  });

  const proc = pty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: clampDim(opts.cols, 2, 1000),
    rows: clampDim(opts.rows, 1, 500),
    cwd,
    env,
  });

  g.__rexTerminalSeq = (g.__rexTerminalSeq ?? 0) + 1;
  const s: Session = {
    id: randomUUID(),
    title: opts.title ?? `${path.basename(shell)} ${g.__rexTerminalSeq}`,
    cwd,
    projectId: opts.projectId ?? null,
    pty: proc,
    buffer: "",
    emitter: new EventEmitter(),
    exited: null,
    createdAt: Date.now(),
  };
  s.emitter.setMaxListeners(50);
  proc.onData((data) => {
    s.buffer += data;
    if (s.buffer.length > MAX_SCROLLBACK) s.buffer = s.buffer.slice(-MAX_SCROLLBACK);
    s.emitter.emit("event", { type: "data", data } satisfies TerminalEvent);
  });
  proc.onExit(({ exitCode, signal }) => {
    s.exited = { exitCode, signal };
    s.emitter.emit("event", { type: "exit", exitCode, signal } satisfies TerminalEvent);
  });
  if (opts.run) proc.write(`${opts.run.replace(/[\r\n]+/g, " ")}\r`);
  sessions.set(s.id, s);
  return info(s);
}

/** Replays scrollback, then streams live events. Returns an unsubscribe function, or null when unknown. */
export function attachTerminal(id: string, onEvent: (ev: TerminalEvent) => void): (() => void) | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (s.buffer) onEvent({ type: "data", data: s.buffer });
  if (s.exited) {
    onEvent({ type: "exit", ...s.exited });
    return () => {};
  }
  s.emitter.on("event", onEvent);
  return () => s.emitter.off("event", onEvent);
}

export function terminalAlive(id: string | null | undefined): boolean {
  const s = id ? sessions.get(id) : undefined;
  return !!s && !s.exited;
}

export function writeTerminal(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  s.pty.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  try {
    s.pty.resize(clampDim(cols, 2, 1000), clampDim(rows, 1, 500));
  } catch {
    return false;
  }
  return true;
}

export function killTerminal(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (!s.exited) {
    try {
      s.pty.kill();
    } catch {
      /* already gone */
    }
    s.exited = { exitCode: -1 };
    s.emitter.emit("event", { type: "exit", exitCode: -1 } satisfies TerminalEvent);
  }
  s.emitter.removeAllListeners();
  sessions.delete(id);
  return true;
}

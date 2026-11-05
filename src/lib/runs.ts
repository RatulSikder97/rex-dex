import "server-only";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { AUTH_ERROR, clearAuthFailure, getAgentSpec, isAgentUsable, markAuthFailure, resolveAgent } from "./ai/agents";
import { agentCwd, getThreadSession, reusableSession, saveThreadSession, sessionFile, supportsSessions } from "./ai/sessions";
import { runProvider } from "./ai/providers";
import { agentMcpServers } from "./connections";
import { resolveDepartment } from "./plugins/registry";
import * as repo from "./repo";
import type { ProviderId, Run, RunEvent } from "./types";

interface LiveRun {
  output: string;
  emitter: EventEmitter;
  controller: AbortController;
}

const g = globalThis as unknown as { __rexLiveRuns?: Map<string, LiveRun>; __rexRunsBooted?: boolean };
const live: Map<string, LiveRun> = (g.__rexLiveRuns ??= new Map());

/** Runs left "running" by a previous server process are marked failed, once per process, on first use. */
function boot() {
  if (g.__rexRunsBooted) return;
  g.__rexRunsBooted = true;
  repo.markOrphanedRuns();
}

export interface StartRunInput {
  department: string;
  /** Agent id; resolved from the department + user preferences when omitted. */
  provider?: ProviderId | null;
  /** Model override for the agent. */
  model?: string | null;
  brief: string;
  projectId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  allowEdits?: boolean;
  /** Extra context appended to the prompt (selected file, audit JSON, etc.). */
  context?: string;
}

const MAX_HISTORY_CHARS = 60_000;

/**
 * Context goes inside <rex-context> so session transcripts (shared with the
 * terminal) can show just the CEO's message. With a resumed agent session the
 * agent already remembers the conversation, so history isn't re-sent.
 */
function buildPrompt(input: StartRunInput, resuming: boolean): string {
  const parts: string[] = [];
  const project = input.projectId ? repo.getProject(input.projectId) : undefined;
  if (project) {
    const open = repo.listTasks(project.id).filter((t) => t.status !== "done");
    parts.push(
      `<project>\nName: ${project.name}\nStage: ${project.stage}\nWebsite: ${project.website_url || "n/a"}\nRepo: ${project.repo_path || "n/a"}\nDescription: ${project.description || "n/a"}\nOpen tasks (${open.length}):\n${open
        .slice(0, 40)
        .map((t) => `- [${t.status}] (${t.department}, ${t.priority}) ${t.title}`)
        .join("\n")}\n</project>`,
    );
  }
  const task = input.taskId ? repo.getTask(input.taskId) : undefined;
  if (task) {
    parts.push(`<task>\nTitle: ${task.title}\nPriority: ${task.priority}\nDetail:\n${task.detail || "n/a"}\n</task>`);
  }
  if (input.threadId && !resuming) {
    const history = repo.listRuns({ threadId: input.threadId }).filter((r) => r.status === "done");
    let transcript = history.map((r) => `CEO: ${r.brief}\n\nYou: ${r.output}`).join("\n\n---\n\n");
    if (transcript.length > MAX_HISTORY_CHARS) transcript = "…(earlier turns omitted)\n" + transcript.slice(-MAX_HISTORY_CHARS);
    if (transcript) parts.push(`<conversation_so_far>\n${transcript}\n</conversation_so_far>`);
  }
  if (input.context) parts.push(`<context>\n${input.context}\n</context>`);
  return parts.length ? `<rex-context>\n${parts.join("\n\n")}\n</rex-context>\n\n${input.brief}` : input.brief;
}

export async function startRun(input: StartRunInput): Promise<Run> {
  boot();
  const dept = resolveDepartment(input.department);
  const provider = await resolveAgent(dept, input.provider);
  const project = input.projectId ? repo.getProject(input.projectId) : undefined;
  const run = repo.createRun({
    project_id: project?.id ?? null,
    task_id: input.taskId ?? null,
    thread_id: input.threadId ?? null,
    department: dept.id,
    provider,
    brief: input.brief,
  });

  const cwd = agentCwd(project?.repo_path);
  const threadId = input.threadId;
  /** Continue the thread's agent-native session (shared with the integrated terminal). */
  const sessionFor = (agent: string): { id: string | null; resume: boolean } | undefined => {
    if (!threadId || !supportsSessions(agent)) return undefined;
    const existing = reusableSession(threadId, agent, cwd);
    const resume = !!existing && !!sessionFile(agent, existing);
    const id = existing ?? (agent === "claude-cli" ? randomUUID() : null);
    saveThreadSession({ thread_id: threadId, agent, session_id: id, cwd, terminal_id: getThreadSession(threadId)?.terminal_id ?? null });
    return { id, resume };
  };

  const state: LiveRun = { output: "", emitter: new EventEmitter(), controller: new AbortController() };
  state.emitter.setMaxListeners(50);
  live.set(run.id, state);

  let lastPersist = Date.now();
  const emit = (ev: RunEvent) => state.emitter.emit("event", ev);
  const write = (text: string) => {
    const at = state.output.length;
    state.output += text;
    emit({ type: "chunk", text, at });
    if (Date.now() - lastPersist > 2000) {
      lastPersist = Date.now();
      repo.saveRunOutput(run.id, state.output);
    }
  };

  void (async () => {
    let agent = provider;
    const tried: string[] = [];
    // Agent picked automatically (no explicit choice): on a sign-in failure, fall back to the next working local agent.
    const autoPicked = !input.provider;
    for (;;) {
      tried.push(agent);
      const session = sessionFor(agent);
      try {
        await runProvider({
          provider: agent,
          model: agent === provider ? (input.model ?? undefined) : undefined,
          system: dept.system,
          prompt: buildPrompt(input, !!session?.resume),
          cwd,
          session,
          onSession: (id) => {
            if (threadId) saveThreadSession({ thread_id: threadId, agent, session_id: id, cwd, terminal_id: getThreadSession(threadId)?.terminal_id ?? null });
          },
          allowEdits: input.allowEdits,
          mcpServers: getAgentSpec(agent)?.mcp ? await agentMcpServers(dept.id) : [],
          signal: state.controller.signal,
          onChunk: write,
        });
        clearAuthFailure(agent);
        repo.finishRun(run.id, state.output, "done", null);
        emit({ type: "status", status: "done" });
        break;
      } catch (err) {
        const cancelled = state.controller.signal.aborted;
        const raw = err instanceof Error ? err.message : String(err);
        const authFailed = !cancelled && AUTH_ERROR.test(raw);
        const name = getAgentSpec(agent)?.name ?? agent;
        if (authFailed) markAuthFailure(agent, summarizeError(raw));
        if (authFailed && autoPicked && !state.output.trim()) {
          const next = await resolveAgent(dept, null, tried);
          if (!tried.includes(next) && (await isAgentUsable(next))) {
            agent = next;
            repo.setRunProvider(run.id, next);
            write(`> ⚠️ ${name} isn't signed in, so ${getAgentSpec(next)?.name ?? next} took this task. Sign ${name} in again from Settings → Agents.\n\n`);
            continue;
          }
        }
        const message = cancelled
          ? null
          : authFailed
            ? `${name} isn't signed in (its login expired or is missing). Open Settings → Agents → ${name} → Sign in, or pick another agent for this department.\n\n${summarizeError(raw)}`
            : summarizeError(raw);
        repo.finishRun(run.id, state.output, cancelled ? "cancelled" : "error", message);
        emit({ type: "status", status: cancelled ? "cancelled" : "error", error: message });
        break;
      }
    }
    // Keep briefly so late subscribers get the final snapshot from memory.
    setTimeout(() => live.delete(run.id), 30_000);
  })();

  return run;
}

export function cancelRun(id: string): boolean {
  const state = live.get(id);
  if (!state) return false;
  state.controller.abort();
  return true;
}

/**
 * Subscribe to a run. Immediately receives a snapshot, then live events.
 * Returns an unsubscribe function.
 */
export function subscribeRun(id: string, onEvent: (ev: RunEvent) => void): () => void {
  boot();
  const state = live.get(id);
  const stored = repo.getRun(id);
  if (!stored) {
    onEvent({ type: "status", status: "error", error: "Run not found" });
    return () => {};
  }
  if (!state || stored.status !== "running") {
    onEvent({ type: "snapshot", output: stored.output, status: stored.status, error: stored.error });
    return () => {};
  }
  onEvent({ type: "snapshot", output: state.output, status: "running" });
  const listener = (ev: RunEvent) => onEvent(ev);
  state.emitter.on("event", listener);
  return () => state.emitter.off("event", listener);
}

/**
 * Run a department to completion and return its text (used for structured
 * one-shot jobs like plan generation). Not persisted as a thread turn.
 */
export async function runToText(input: StartRunInput): Promise<string> {
  const run = await startRun(input);
  return new Promise((resolve, reject) => {
    let out = "";
    const unsub = subscribeRun(run.id, (ev) => {
      if (ev.type === "snapshot") {
        out = ev.output;
        if (ev.status === "done") resolve(out);
        else if (ev.status !== "running") reject(new Error(ev.error || ev.status));
      } else if (ev.type === "chunk") {
        out = applyChunk(out, ev);
      } else if (ev.type === "status") {
        setTimeout(() => unsub(), 0);
        if (ev.status === "done") resolve(out);
        else reject(new Error(ev.error || ev.status));
      }
    });
  });
}

/** Extracts the first JSON value (object or array) from model text. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in model output");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/**
 * CLI failures arrive as raw stderr: timestamps, log prefixes and the same
 * line repeated dozens of times. Keep the distinct, readable lines.
 */
export function summarizeError(raw: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (let line of raw.split("\n")) {
    line = line
      .replace(/^\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "")
      .replace(/^(ERROR|WARN|INFO|DEBUG)\s+[\w:]+:\s*/, "")
      .trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= 6) break;
  }
  const out = lines.join("\n");
  return out.length > 700 ? out.slice(0, 700) + "…" : out;
}

/** Applies a streamed chunk by its offset: duplicate or replayed chunks don't double the text. */
export function applyChunk(output: string, ev: { text: string; at?: number }): string {
  if (ev.at === undefined) return output + ev.text;
  if (output.length === ev.at) return output + ev.text;
  if (output.length > ev.at) return output.slice(ev.at, ev.at + ev.text.length) === ev.text ? output : output.slice(0, ev.at) + ev.text;
  return output + ev.text; // gap (missed chunks): best effort; the final snapshot corrects it
}

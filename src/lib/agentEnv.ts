import "server-only";

/**
 * Environment for terminal agents and integrated terminals.
 *
 * When REX itself was started from inside a Claude Code session, the parent's
 * session markers leak into every child: a nested `claude` then thinks it is a
 * sub-session (transcript saving off, so sessions can't be resumed or synced).
 * Strip those markers so each agent runs as a normal top-level CLI.
 */
const SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "NODE_OPTIONS",
];

export function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && !SESSION_MARKERS.includes(k)) env[k] = v;
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

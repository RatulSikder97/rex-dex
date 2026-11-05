import { discoverCodexSession, getThreadSession, readTranscript, saveThreadSession } from "@/lib/ai/sessions";
import { handle, ok } from "@/lib/http";
import { terminalAlive } from "@/lib/terminal";

export const dynamic = "force-dynamic";

/**
 * GET /api/threads/:id → the conversation's agent-native session, whether its
 * interactive terminal is open, and the session transcript (which includes
 * turns typed in the terminal). transcript is null when there's no session file yet.
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  let s = getThreadSession(id);
  if (!s) return ok({ session: null, terminalAlive: false, transcript: null });
  if (s.agent === "codex-cli" && !s.session_id && s.terminal_id) {
    const found = discoverCodexSession(s.cwd, s.updated_at);
    if (found) {
      saveThreadSession({ ...s, session_id: found });
      s = { ...s, session_id: found };
    }
  }
  const alive = terminalAlive(s.terminal_id);
  const transcript = s.session_id ? readTranscript(s.agent, s.session_id) : null;
  // Name terminal-only conversations after their first message.
  const firstUser = transcript?.find((t) => t.role === "user")?.text;
  if (!s.title && firstUser) saveThreadSession({ ...s, title: firstUser.replace(/\s+/g, " ").slice(0, 120) });
  return ok({
    session: { agent: s.agent, sessionId: s.session_id, cwd: s.cwd, terminalId: alive ? s.terminal_id : null },
    terminalAlive: alive,
    transcript,
  });
});

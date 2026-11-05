import { z } from "zod";
import { getThreadSession } from "@/lib/ai/sessions";
import { body, fail, handle, ok } from "@/lib/http";
import { terminalAlive, writeTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

const Schema = z.object({ text: z.string().trim().min(1).max(100_000) });

/**
 * POST /api/threads/:id/send {text} — while the conversation is open as an
 * interactive agent in the terminal, the Agent panel types into that session
 * (bracketed paste keeps multi-line messages as one prompt), then submits.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { text } = await body(req, Schema);
  const s = getThreadSession(id);
  if (!s?.terminal_id || !terminalAlive(s.terminal_id)) return fail("This conversation isn't open in a terminal", 409);
  writeTerminal(s.terminal_id, `\x1b[200~${text}\x1b[201~`);
  await new Promise((r) => setTimeout(r, 120));
  writeTerminal(s.terminal_id, "\r");
  return ok({ terminalId: s.terminal_id });
});

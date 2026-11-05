import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { updateStep } from "@/lib/swarms";

export const dynamic = "force-dynamic";

const Action = z.object({
  action: z.enum(["retry", "skip", "set-agent", "edit"]),
  agent: z.string().regex(/^[a-z0-9-]{2,40}$/).or(z.literal("")).nullish(),
  brief: z.string().min(1).max(8000).optional(),
  title: z.string().min(1).max(120).optional(),
  department: z.string().min(1).max(40).optional(),
});

/** POST: retry / skip a step, re-assign its agent, or edit its brief before it runs. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string; stepId: string }> }) => {
  const { id, stepId } = await ctx.params;
  const { action, ...patch } = await body(req, Action);
  return ok(updateStep(id, stepId, action, patch));
});

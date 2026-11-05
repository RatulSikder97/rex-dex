import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { bootSwarms, cancelSwarm, deleteSwarm, getSwarm, startSwarm } from "@/lib/swarms";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  bootSwarms();
  const s = getSwarm((await ctx.params).id);
  return s ? ok(s) : fail("Swarm not found", 404);
});

const Action = z.object({ action: z.enum(["start", "cancel"]) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { action } = await body(req, Action);
  if (action === "start") startSwarm(id);
  else cancelSwarm(id);
  return ok(getSwarm(id));
});

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  deleteSwarm((await ctx.params).id);
  return ok({ ok: true });
});

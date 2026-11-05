import { handle, ok } from "@/lib/http";
import { deleteMonitor } from "@/lib/ops/monitors";

export const dynamic = "force-dynamic";

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  deleteMonitor((await ctx.params).id);
  return ok({ ok: true });
});

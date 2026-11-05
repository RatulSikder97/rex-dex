import { fail, handle, ok } from "@/lib/http";
import { checkMonitor } from "@/lib/ops/monitors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const m = await checkMonitor((await ctx.params).id);
  return m ? ok(m) : fail("Monitor not found", 404);
});

import { fail, handle, ok } from "@/lib/http";
import { getServer, takeSnapshot } from "@/lib/ops/servers";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** POST: health + who's on + connections + traffic over one read-only SSH script. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = getServer((await ctx.params).id);
  if (!s) return fail("Server not found", 404);
  return ok(await takeSnapshot(s));
});

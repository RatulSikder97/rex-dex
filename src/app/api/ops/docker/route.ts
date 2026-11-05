import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { dockerAction, dockerInfo } from "@/lib/ops/containers";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const GET = handle(async (req: Request) => ok(await dockerInfo(new URL(req.url).searchParams.get("serverId"))));

const Action = z.object({ serverId: z.string().nullish(), container: z.string().min(1).max(253), action: z.enum(["start", "stop", "restart", "logs"]) });

export const POST = handle(async (req: Request) => {
  const a = await body(req, Action);
  return ok({ ok: true, output: await dockerAction(a.serverId, a.container, a.action) });
});

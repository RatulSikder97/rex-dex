import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { installPlugin, listInstalled } from "@/lib/plugins/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const GET = handle(async () => ok(listInstalled()));

/** Install from a catalog id ("builtin:<dir>"), git URL, or absolute local folder. */
export const POST = handle(async (req: Request) => {
  const { source } = await body(req, z.object({ source: z.string().trim().min(1).max(1000) }));
  return ok(await installPlugin(source), { status: 201 });
});

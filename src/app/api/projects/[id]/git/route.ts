import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { gitOp } from "@/lib/ops/gitops";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Op = z.discriminatedUnion("action", [
  z.object({ action: z.literal("init") }),
  z.object({ action: z.literal("set-remote"), url: z.string().trim().min(1).max(500), name: z.string().max(100).optional() }),
  z.object({ action: z.literal("remove-remote"), name: z.string().min(1).max(100) }),
  z.object({ action: z.literal("clone"), url: z.string().trim().min(1).max(500), folder: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("create-github"), name: z.string().trim().min(1).max(100), visibility: z.enum(["private", "public"]).default("private"), description: z.string().max(300).optional() }),
  z.object({ action: z.enum(["fetch", "pull", "push"]) }),
]);

/** POST /api/projects/:id/git — connect / create / sync the project's repository. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => ok(await gitOp((await ctx.params).id, await body(req, Op))));

import { z } from "zod";
import { projectRoot } from "@/lib/fsx";
import * as gitx from "@/lib/git";
import { body, fail, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/git?projectId= → working tree status. */
export const GET = handle(async (req: Request) => {
  const root = projectRoot(new URL(req.url).searchParams.get("projectId"));
  if (root instanceof Response) return root;
  return ok(await gitx.status(root));
});

const Paths = z.array(z.string().min(1).max(4096)).min(1).max(5000);
const OpSchema = z.discriminatedUnion("op", [
  z.object({ projectId: z.string(), op: z.literal("stage"), paths: Paths }),
  z.object({ projectId: z.string(), op: z.literal("unstage"), paths: Paths }),
  z.object({ projectId: z.string(), op: z.literal("discard"), paths: Paths }),
  z.object({ projectId: z.string(), op: z.literal("commit"), message: z.string().trim().min(1).max(20_000) }),
  z.object({ projectId: z.string(), op: z.literal("init") }),
]);

/** POST /api/git {projectId, op, paths?|message?} → mutates the repo, returns fresh status. */
export const POST = handle(async (req: Request) => {
  const input = await body(req, OpSchema);
  const root = projectRoot(input.projectId);
  if (root instanceof Response) return root;
  if (input.op !== "init" && !(await gitx.isRepo(root))) return fail("Not a git repository", 400);
  let commit: string | undefined;
  switch (input.op) {
    case "stage":
      await gitx.stage(root, input.paths);
      break;
    case "unstage":
      await gitx.unstage(root, input.paths);
      break;
    case "discard":
      await gitx.discard(root, input.paths);
      break;
    case "commit":
      commit = await gitx.commit(root, input.message);
      break;
    case "init":
      await gitx.init(root);
      break;
  }
  return ok({ ok: true, commit, status: await gitx.status(root) });
});

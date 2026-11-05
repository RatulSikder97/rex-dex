import { projectRoot } from "@/lib/fsx";
import { isRepo, log } from "@/lib/git";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/git/log?projectId&limit=20 → recent commits. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const root = projectRoot(sp.get("projectId"));
  if (root instanceof Response) return root;
  if (!(await isRepo(root))) return ok([]);
  return ok(await log(root, Number(sp.get("limit") ?? 20) || 20));
});

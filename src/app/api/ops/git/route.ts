import { fail, handle, ok } from "@/lib/http";
import { gitInfo } from "@/lib/ops/gitinfo";
import { getProject } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/ops/git?projectId= → branch, remotes (+web links), commits, PRs / CI runs / issues via gh. null = no repo. */
export const GET = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("projectId");
  const p = id ? getProject(id) : undefined;
  if (!p) return fail("Project not found", 404);
  return ok(p.repo_path ? await gitInfo(p.repo_path) : null);
});

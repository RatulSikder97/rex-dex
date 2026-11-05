import { projectRoot } from "@/lib/fsx";
import { fileVersions } from "@/lib/git";
import { fail, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/git/show?projectId&path[&from] → {head, index, working, binary} (null = version absent). `from` = rename source. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const root = projectRoot(sp.get("projectId"));
  if (root instanceof Response) return root;
  const path = sp.get("path");
  if (!path) return fail("Missing path", 400);
  return ok(await fileVersions(root, path, sp.get("from") || undefined));
});

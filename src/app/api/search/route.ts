import { projectRoot } from "@/lib/fsx";
import { fail, handle, ok } from "@/lib/http";
import { searchFiles } from "@/lib/search";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const root = projectRoot(sp.get("projectId"));
  if (root instanceof Response) return root;
  const q = sp.get("q") ?? "";
  if (!q) return ok({ files: [], total: 0, truncated: false });
  if (q.length > 1000) return fail("Query too long", 400);
  const glob = sp.get("glob") ?? "";
  if (glob.length > 500) return fail("Glob too long", 400);
  return ok(await searchFiles(root, { query: q, regex: sp.get("regex") === "1", caseSensitive: sp.get("case") === "1", glob }));
});

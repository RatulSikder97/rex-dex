import { handle, ok } from "@/lib/http";
import { listAllThreads } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** GET /api/threads/all[?projectId=…][&limit=…] → conversations across every department (Mission task list). */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const limit = Number(sp.get("limit")) || undefined;
  return ok(listAllThreads(sp.get("projectId") || null, limit));
});

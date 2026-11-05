import { z } from "zod";
import { fail, handle, ok } from "@/lib/http";
import { deleteThreadSession } from "@/lib/ai/sessions";
import { deleteThread, listThreads } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** GET /api/threads?department=…[&projectId=…] → agent conversation history for the Agent panel. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const department = sp.get("department");
  if (!department) return fail("Missing department", 400);
  return ok(listThreads(department, sp.get("projectId") || null));
});

/** DELETE /api/threads?id=… removes a finished conversation. */
export const DELETE = handle(async (req: Request) => {
  const id = z.string().min(1).max(80).safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return fail("Missing id", 400);
  deleteThread(id.data);
  deleteThreadSession(id.data);
  return ok({ ok: true });
});

import { fail, handle, ok } from "@/lib/http";
import { cancelJob, getJobFull } from "@/lib/media/pipeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const id = (await params).id;
  if (!getJobFull(id)) return fail("Job not found", 404);
  if (!cancelJob(id)) return fail("Job is not running", 409);
  return ok({ ok: true });
});

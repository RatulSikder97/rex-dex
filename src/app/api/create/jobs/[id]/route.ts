import { fail, handle, ok } from "@/lib/http";
import { getJobFull, removeJob } from "@/lib/media/pipeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const job = getJobFull((await params).id);
  return job ? ok(job) : fail("Job not found", 404);
});

/** Deletes the job row only; the produced media file stays in the library. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  return removeJob((await params).id) ? ok({ ok: true }) : fail("Job not found", 404);
});

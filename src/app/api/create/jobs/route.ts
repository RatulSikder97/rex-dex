import { z } from "zod";
import { fail, handle, ok } from "@/lib/http";
import { JOB_KINDS, JobOptionsSchema, planSchemaFor } from "@/lib/media/plan";
import { listRecentJobs, startJob } from "@/lib/media/pipeline";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  kind: z.enum(JOB_KINDS),
  title: z.string().trim().min(1).max(200),
  plan: z.unknown(),
  options: JobOptionsSchema,
  projectId: z.string().nullish(),
});

/** Recent jobs (no logs). */
export const GET = handle(async () => ok(listRecentJobs()));

/** Create a job and start producing it immediately (in the background). */
export const POST = handle(async (req: Request) => {
  const input = CreateSchema.parse(await req.json());
  const plan = planSchemaFor(input.kind).parse(input.plan);
  if (input.kind !== "video" && input.options.tts === "none") return fail("Voiceover and podcast jobs need a voice provider");
  return ok(startJob({ projectId: input.projectId ?? null, kind: input.kind, title: input.title, options: input.options, plan }), { status: 201 });
});

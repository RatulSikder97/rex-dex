import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { ASPECTS, JOB_KINDS } from "@/lib/media/plan";
import { draftScript } from "@/lib/media/script";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const ScriptSchema = z.object({
  kind: z.enum(JOB_KINDS),
  brief: z.string().trim().min(1).max(10_000),
  provider: z.string().max(40).nullish(),
  projectId: z.string().nullish(),
  aspect: z.enum(ASPECTS).optional(),
  targetSeconds: z.number().min(5).max(900).optional(),
  style: z.string().max(2000).optional(),
});

/** Brief → structured plan (video scenes, voiceover segments or podcast lines). Not executed. */
export const POST = handle(async (req: Request) => ok(await draftScript(await body(req, ScriptSchema))));

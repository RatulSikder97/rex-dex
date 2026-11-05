import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { extractJson, runToText } from "@/lib/runs";
import { listMedia, probe, VIDEO_OP_DOCS, VideoOpSchema } from "@/lib/video";

export const maxDuration = 300;

const PlanSchema = z.object({
  input: z.string().min(1),
  instruction: z.string().trim().min(1).max(10_000),
  provider: z.string().max(40).nullish(),
  projectId: z.string().nullish(),
});

/** Natural-language edit → validated op list (not executed; the UI reviews then runs it). */
export const POST = handle(async (req: Request) => {
  const input = await body(req, PlanSchema);
  const info = await probe(input.input);
  const library = listMedia().map((m) => m.name).join(", ");
  const brief = `Translate the edit request into an ffmpeg edit pipeline for REX Video Studio.
Input file: ${input.input} — ${JSON.stringify(info)}
Media library: ${library}
${VIDEO_OP_DOCS}
Respond with ONLY JSON: {"ops":[...], "notes":"one sentence on what the pipeline does"}

Edit request: ${input.instruction}`;
  const text = await runToText({ department: "video", provider: input.provider, brief, projectId: input.projectId ?? null });
  const parsed = z.object({ ops: z.array(VideoOpSchema).min(1).max(20), notes: z.string().default("") }).parse(extractJson(text));
  return ok(parsed);
});

import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { runPipeline, VideoOpSchema } from "@/lib/video";

export const maxDuration = 1800;

const PipelineSchema = z.object({ input: z.string().min(1), ops: z.array(VideoOpSchema).min(1).max(20) });

/** Executes a validated edit pipeline with ffmpeg; returns every intermediate output. */
export const POST = handle(async (req: Request) => {
  const { input, ops } = await body(req, PipelineSchema);
  return ok(await runPipeline(input, ops));
});

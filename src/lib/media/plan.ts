import { z } from "zod";

/**
 * Create Studio plan + job shapes. Client-safe (no server imports): the UI uses
 * the types, the server validates with the schemas.
 */

export const ASPECTS = ["9:16", "16:9", "1:1", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_SIZES: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

export const JOB_KINDS = ["video", "voiceover", "podcast"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SceneSchema = z.object({
  narration: z.string().max(2000).default(""),
  onScreenText: z.string().max(200).default(""),
  visualPrompt: z.string().max(2000).default(""),
  durationSec: z.coerce.number().min(1).max(120).default(5),
});

export const VideoPlanSchema = z.object({
  title: z.string().trim().min(1).max(200),
  musicMood: z.string().max(100).default(""),
  scenes: z.array(SceneSchema).min(1).max(40),
});

export const VoiceoverPlanSchema = z.object({
  title: z.string().trim().min(1).max(200),
  segments: z.array(z.object({ text: z.string().trim().min(1).max(4000) })).min(1).max(100),
});

export const PodcastPlanSchema = z.object({
  title: z.string().trim().min(1).max(200),
  hosts: z.tuple([z.string().trim().min(1).max(60), z.string().trim().min(1).max(60)]),
  lines: z
    .array(z.object({ speaker: z.coerce.number().int().min(0).max(1), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(300),
});

export type Scene = z.infer<typeof SceneSchema>;
export type VideoPlan = z.infer<typeof VideoPlanSchema>;
export type VoiceoverPlan = z.infer<typeof VoiceoverPlanSchema>;
export type PodcastPlan = z.infer<typeof PodcastPlanSchema>;
export type AnyPlan = VideoPlan | VoiceoverPlan | PodcastPlan;

export const JobOptionsSchema = z.object({
  /** TTS provider id, or "none" for a silent video. */
  tts: z.string().min(1).max(60).default("none"),
  voice: z.string().max(120).optional(),
  voice2: z.string().max(120).optional(),
  image: z.string().max(60).optional(),
  /** "none" | "ambient" | a media-library audio/video file name. */
  music: z.string().min(1).max(200).default("none"),
  captions: z.boolean().optional(),
  aspect: z.enum(ASPECTS).optional(),
});
export type JobOptions = z.infer<typeof JobOptionsSchema>;

export function planSchemaFor(kind: JobKind) {
  return kind === "video" ? VideoPlanSchema : kind === "voiceover" ? VoiceoverPlanSchema : PodcastPlanSchema;
}

export interface MediaJob {
  id: string;
  project_id: string | null;
  kind: JobKind;
  title: string;
  status: JobStatus;
  options: JobOptions;
  plan: AnyPlan;
  progress: number;
  step: string;
  logs: string;
  output: string | null;
  srt: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export const WORDS_PER_SEC = 2.5;

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Rough spoken length used for previews before TTS runs. */
export function estimateSpeechSec(text: string): number {
  return wordCount(text) / WORDS_PER_SEC;
}

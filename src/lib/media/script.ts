import "server-only";
import { extractJson, runToText } from "../runs";
import type { ProviderId } from "../types";
import {
  PodcastPlanSchema,
  VideoPlanSchema,
  VoiceoverPlanSchema,
  WORDS_PER_SEC,
  type Aspect,
  type AnyPlan,
  type JobKind,
  type VideoPlan,
} from "./plan";

export interface ScriptInput {
  kind: JobKind;
  brief: string;
  provider?: ProviderId | null;
  projectId?: string | null;
  aspect?: Aspect;
  targetSeconds?: number;
  style?: string;
}

const JSON_RULES = `Output rules: respond with ONLY one JSON object. No prose before or after, no markdown, no code fences, no comments. Use plain double-quoted JSON strings.`;

function framing(aspect: Aspect): string {
  if (aspect === "9:16") return "vertical 9:16 (phone, Reels/Shorts/TikTok): bold, close subjects, punchy pacing";
  if (aspect === "16:9") return "horizontal 16:9 (YouTube, website): wider compositions, calmer pacing";
  if (aspect === "1:1") return "square 1:1 (feed post): centered compositions";
  return "portrait 4:5 (feed post): centered, slightly tall compositions";
}

function videoBrief(i: ScriptInput): string {
  const target = Math.round(i.targetSeconds ?? 30);
  const aspect = i.aspect ?? "9:16";
  const scenes = Math.min(12, Math.max(3, Math.round(target / 5)));
  const words = Math.round(target * WORDS_PER_SEC);
  return `Write a narrated video script for an AI video pipeline (TTS narration over generated stills with Ken Burns motion).

Target length: ${target} seconds total. Use about ${scenes} scenes. The sum of all durationSec values must be ${target} (±10%).
Narration pace: about ${WORDS_PER_SEC} words per second, so each scene's narration has roughly durationSec × ${WORDS_PER_SEC} words (≈${words} words total). Narration is spoken aloud: natural sentences, no stage directions, no emojis, no hashtags.
Format: ${framing(aspect)}.
onScreenText: a short headline for the scene, at most 6 words, or "" for none. Open with a hook; close with a clear call to action.
visualPrompt: a vivid description of ONE still image for the scene (subject, setting, lighting, palette, composition for ${aspect}). The image itself must contain no text.
musicMood: one or two words (e.g. "uplifting", "calm tech").
${i.style ? `Style / voice: ${i.style}\n` : ""}
JSON shape:
{"title": string, "musicMood": string, "scenes": [{"narration": string, "onScreenText": string, "visualPrompt": string, "durationSec": number}]}

${JSON_RULES}

Brief: ${i.brief}`;
}

function voiceoverBrief(i: ScriptInput): string {
  const target = i.targetSeconds ? Math.round(i.targetSeconds) : null;
  return `Write a voiceover script to be read aloud by a text-to-speech voice.
${target ? `Target length: about ${target} seconds (≈${Math.round(target * WORDS_PER_SEC)} words at ${WORDS_PER_SEC} words/sec).` : "Keep it as long as the brief needs, typically 45-120 seconds."}
Split it into segments of one to three sentences each (a natural pause happens between segments). Spoken language only: no headings, stage directions, emojis or markdown.
${i.style ? `Style / voice: ${i.style}\n` : ""}
JSON shape:
{"title": string, "segments": [{"text": string}]}

${JSON_RULES}

Brief: ${i.brief}`;
}

function podcastBrief(i: ScriptInput): string {
  const target = Math.round(i.targetSeconds ?? 180);
  return `Write a two-host podcast episode script to be performed by two text-to-speech voices.
Target length: about ${target} seconds (≈${Math.round(target * WORDS_PER_SEC)} words total at ${WORDS_PER_SEC} words/sec).
Two hosts with distinct perspectives who riff naturally: short back-and-forth lines, occasional questions and reactions, a crisp intro and a sign-off. Spoken language only: no stage directions, sound cues, emojis or markdown.
speaker is 0 for the first host and 1 for the second. Alternate often.
${i.style ? `Style / voice: ${i.style}\n` : ""}
JSON shape:
{"title": string, "hosts": [string, string], "lines": [{"speaker": 0 | 1, "text": string}]}

${JSON_RULES}

Brief: ${i.brief}`;
}

/** Scale scene durations so they sum to the target, keeping each ≥ its spoken length. */
function fitDurations(plan: VideoPlan, target: number): VideoPlan {
  const sum = plan.scenes.reduce((a, s) => a + s.durationSec, 0);
  if (!sum || Math.abs(sum - target) / target <= 0.1) return plan;
  const k = target / sum;
  return { ...plan, scenes: plan.scenes.map((s) => ({ ...s, durationSec: Math.max(1.5, Math.round(s.durationSec * k * 10) / 10) })) };
}

export async function draftScript(input: ScriptInput): Promise<AnyPlan> {
  const department = input.kind === "video" ? "video" : "content";
  const brief = input.kind === "video" ? videoBrief(input) : input.kind === "voiceover" ? voiceoverBrief(input) : podcastBrief(input);
  const text = await runToText({ department, provider: input.provider, brief, projectId: input.projectId ?? null });
  const raw = extractJson<unknown>(text);
  if (input.kind === "video") return fitDurations(VideoPlanSchema.parse(raw), input.targetSeconds ?? 30);
  if (input.kind === "voiceover") return VoiceoverPlanSchema.parse(raw);
  return PodcastPlanSchema.parse(raw);
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MEDIA_DIR } from "../db";
import { safeMediaName } from "../video";
import { MP3_ARGS, MUSIC_UNDER_LUFS, WAV_ARGS, concatWavs, mixVoiceMusic, musicBed, padTo, silence, speak } from "./audio";
import { AbortedError, ffmpeg, filterPath, fontFile, srtTime, wrapText } from "./ff";
import * as jobs from "./jobs";
import {
  ASPECT_SIZES,
  WORDS_PER_SEC,
  wordCount,
  type AnyPlan,
  type Aspect,
  type JobKind,
  type JobOptions,
  type MediaJob,
  type PodcastPlan,
  type VideoPlan,
  type VoiceoverPlan,
} from "./plan";
import { getImage } from "./providers";

/**
 * Create Studio job runner. Jobs run in-process, one at a time, from a
 * globalThis queue; each has an AbortController that kills the ffmpeg child.
 */

const FPS = 30;
const XFADE = 0.4;

const g = globalThis as unknown as {
  __rexMediaLive?: Map<string, AbortController>;
  __rexMediaBooted?: boolean;
  __rexMediaQueue?: Promise<void>;
};
const live: Map<string, AbortController> = (g.__rexMediaLive ??= new Map());

function boot() {
  if (g.__rexMediaBooted) return;
  g.__rexMediaBooted = true;
  jobs.markOrphanedJobs([...live.keys()]);
}

// ---------------------------------------------------------------------------
// public API (used by routes)
// ---------------------------------------------------------------------------

export function listRecentJobs() {
  boot();
  return jobs.listJobs(50);
}

export function getJobFull(id: string): MediaJob | undefined {
  boot();
  return jobs.getJob(id);
}

export function startJob(input: { projectId: string | null; kind: JobKind; title: string; options: JobOptions; plan: AnyPlan }): MediaJob {
  boot();
  if (input.kind !== "video" && input.options.tts === "none") throw new Error("Voiceover and podcast jobs need a voice provider");
  const job = jobs.createJob(input);
  const ctrl = new AbortController();
  live.set(job.id, ctrl);
  jobs.appendJobLog(job.id, `Queued ${input.kind} "${input.title}"`);
  g.__rexMediaQueue = (g.__rexMediaQueue ?? Promise.resolve()).then(() => execute(job.id, ctrl)).catch(() => {});
  return job;
}

export function cancelJob(id: string): boolean {
  boot();
  const ctrl = live.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  const job = jobs.getJob(id);
  if (job?.status === "queued") jobs.updateJob(id, { status: "cancelled", step: "Cancelled" });
  return true;
}

export function removeJob(id: string): boolean {
  boot();
  live.get(id)?.abort();
  return jobs.deleteJob(id);
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

interface Ctx {
  id: string;
  dir: string;
  signal: AbortSignal;
  log: (line: string) => void;
  step: (progress: number, step: string) => void;
}

interface Produced {
  file: string;
  ext: string;
  srt?: string | null;
}

async function execute(id: string, ctrl: AbortController) {
  const dir = path.join(DATA_DIR, "jobs", id);
  const signal = ctrl.signal;
  try {
    const job = jobs.getJob(id);
    if (!job) return;
    if (signal.aborted || job.status === "cancelled") throw new AbortedError();
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    const ctx: Ctx = {
      id,
      dir,
      signal,
      log: (line) => jobs.appendJobLog(id, line),
      step: (progress, step) => {
        jobs.updateJob(id, { progress: Math.max(0, Math.min(99, Math.round(progress))), step });
        jobs.appendJobLog(id, step);
      },
    };
    jobs.updateJob(id, { status: "running", progress: 1, step: "Starting" });
    const t0 = Date.now();
    const result =
      job.kind === "video"
        ? await produceVideo(ctx, job.plan as VideoPlan, job.options)
        : job.kind === "voiceover"
          ? await produceVoiceover(ctx, job.plan as VoiceoverPlan, job.options)
          : await producePodcast(ctx, job.plan as PodcastPlan, job.options);
    signal.throwIfAborted();
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const name = safeMediaName(`${job.title}${result.ext}`);
    fs.renameSync(/*turbopackIgnore: true*/ result.file, path.join(MEDIA_DIR, name));
    jobs.updateJob(id, { status: "done", progress: 100, step: "Done", output: name, srt: result.srt ?? null, error: null });
    jobs.appendJobLog(id, `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${name}`);
    fs.rmSync(/*turbopackIgnore: true*/ dir, { recursive: true, force: true });
  } catch (err) {
    const cancelled = signal.aborted || err instanceof AbortedError;
    const message = err instanceof Error ? err.message : String(err);
    if (cancelled) {
      jobs.updateJob(id, { status: "cancelled", step: "Cancelled" });
      jobs.appendJobLog(id, "Cancelled");
      fs.rmSync(/*turbopackIgnore: true*/ dir, { recursive: true, force: true });
    } else {
      jobs.updateJob(id, { status: "error", step: "Failed", error: message });
      jobs.appendJobLog(id, `ERROR: ${message}`);
      jobs.appendJobLog(id, `Intermediate files kept in ${dir}`);
    }
  } finally {
    live.delete(id);
  }
}

const frames = (sec: number) => Math.max(1, Math.round(sec * FPS));
const snap = (sec: number) => Math.ceil(sec * FPS) / FPS;

// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

function captionStyle(aspect: Aspect): string {
  // libass scales SRT styles against PlayResY=288.
  const size = { "9:16": 10, "16:9": 17, "1:1": 15, "4:5": 13 }[aspect];
  const margin = { "9:16": 58, "16:9": 22, "1:1": 26, "4:5": 34 }[aspect];
  return `FontName=Arial,Bold=1,FontSize=${size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=${margin}`;
}

/** Split each scene's narration into ≤7-word chunks spread across its voiced time. */
function buildSrt(scenes: { start: number; text: string; voiced: number }[]): string {
  const out: string[] = [];
  let n = 1;
  for (const s of scenes) {
    const words = s.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length || s.voiced <= 0) continue;
    const parts = Math.ceil(words.length / 7);
    const per = Math.ceil(words.length / parts);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per).join(" "));
    const weight = chunks.map((c) => c.length + 4);
    const total = weight.reduce((a, b) => a + b, 0);
    let t = s.start;
    chunks.forEach((c, i) => {
      const d = (s.voiced * weight[i]) / total;
      out.push(`${n++}\n${srtTime(t)} --> ${srtTime(t + d - 0.02)}\n${c}\n`);
      t += d;
    });
  }
  return out.join("\n");
}

function cardHeadline(scene: VideoPlan["scenes"][number], title: string): string {
  if (scene.onScreenText.trim()) return scene.onScreenText.trim();
  const w = scene.narration.trim().split(/\s+/).filter(Boolean);
  return w.length ? w.slice(0, 8).join(" ") + (w.length > 8 ? "…" : "") : title;
}

async function produceVideo(ctx: Ctx, plan: VideoPlan, opt: JobOptions): Promise<Produced> {
  const aspect = opt.aspect ?? "9:16";
  const [W, H] = ASPECT_SIZES[aspect];
  const n = plan.scenes.length;
  const voiced = opt.tts !== "none";
  const imageId = opt.image || "title-card";
  ctx.log(`Video ${W}x${H} · ${n} scenes · voice ${voiced ? `${opt.tts}/${opt.voice ?? "default"}` : "none"} · images ${imageId} · music ${opt.music}${opt.captions ? " · captions" : ""}`);

  // 1. narration
  const voice: ({ file: string; dur: number } | null)[] = [];
  for (let i = 0; i < n; i++) {
    ctx.signal.throwIfAborted();
    const text = plan.scenes[i].narration.trim();
    if (!voiced || !text) {
      voice.push(null);
      continue;
    }
    ctx.step(2 + (i / n) * 20, `Voicing scene ${i + 1}/${n}`);
    voice.push(await speak({ provider: opt.tts, voice: opt.voice, text, dir: ctx.dir, base: `voice-${i}`, signal: ctx.signal }));
  }
  const durs = plan.scenes.map((s, i) => snap(Math.max(s.durationSec, (voice[i]?.dur ?? 0) + 0.5)));
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));
  const total = durs.reduce((a, b) => a + b, 0);
  ctx.log(`Scene durations: ${durs.map((d) => d.toFixed(2)).join(", ")} = ${total.toFixed(2)}s`);

  // 2. images
  const provider = await getImage(imageId);
  const fallback = imageId === "title-card" ? provider : await getImage("title-card");
  const images: { file: string; isCard: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    ctx.signal.throwIfAborted();
    ctx.step(22 + (i / n) * 25, `Image ${i + 1}/${n} (${provider.label})`);
    const s = plan.scenes[i];
    const raw = path.join(ctx.dir, `img-${i}.raw.png`);
    let isCard = imageId === "title-card";
    try {
      await provider.generate({ prompt: isCard ? cardHeadline(s, plan.title) : s.visualPrompt || s.onScreenText || plan.title, width: W, height: H, outPath: raw, signal: ctx.signal });
    } catch (e) {
      if (ctx.signal.aborted) throw new AbortedError();
      ctx.log(`Image provider failed for scene ${i + 1} (${e instanceof Error ? e.message.slice(0, 200) : e}); using a title card`);
      isCard = true;
      await fallback.generate({ prompt: cardHeadline(s, plan.title), width: W, height: H, outPath: raw, signal: ctx.signal });
    }
    const img = path.join(ctx.dir, `img-${i}.png`);
    await ffmpeg(["-i", raw, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`, "-frames:v", "1", img], ctx.signal);
    images.push({ file: img, isCard });
  }

  // 3. clips (Ken Burns + on-screen text). Clips before the last are XFADE longer; the overlap eats it.
  const font = fontFile();
  const fontSize = Math.round(Math.min(W, H) * (aspect === "16:9" ? 0.068 : 0.078));
  const clips: string[] = [];
  for (let i = 0; i < n; i++) {
    ctx.signal.throwIfAborted();
    ctx.step(47 + (i / n) * 30, `Rendering clip ${i + 1}/${n}`);
    const len = durs[i] + (n > 1 && i < n - 1 ? XFADE : 0);
    const N = frames(len);
    const zoomIn = i % 2 === 0;
    const dir = i % 4 < 2 ? 1 : -1;
    const z = zoomIn ? `1+0.14*on/${N}` : `1.14-0.14*on/${N}`;
    const x = `(iw-iw/zoom)*(0.5+${dir}*0.3*(on/${N}-0.5))`;
    const y = `(ih-ih/zoom)*(0.5-${dir}*0.15*(on/${N}-0.5))`;
    const filters = [`scale=${W * 2}:${H * 2}:flags=lanczos`, `zoompan=z='${z}':x='${x}':y='${y}':d=${N}:s=${W}x${H}:fps=${FPS}`];
    const text = plan.scenes[i].onScreenText.trim();
    if (text && !images[i].isCard) {
      const txt = path.join(ctx.dir, `text-${i}.txt`);
      const maxChars = Math.max(10, Math.floor((W * 0.84) / (fontSize * 0.56)));
      fs.writeFileSync(/*turbopackIgnore: true*/ txt, wrapText(text, maxChars).slice(0, 3).join("\n"));
      filters.push(
        `drawtext=${font ? `fontfile='${filterPath(font)}':` : ""}textfile='${filterPath(txt)}':fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize * 0.2)}:text_align=C:box=1:boxcolor=black@0.42:boxborderw=${Math.round(fontSize * 0.45)}:borderw=2:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.17:alpha='min(1,t/0.45)'`,
      );
    }
    filters.push("format=yuv420p");
    const clip = path.join(ctx.dir, `clip-${i}.mp4`);
    await ffmpeg(["-i", images[i].file, "-vf", filters.join(","), "-frames:v", String(N), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", clip], ctx.signal);
    clips.push(clip);
  }

  // 4–5. narration track + music
  ctx.step(78, "Mixing audio");
  const padded: string[] = [];
  for (let i = 0; i < n; i++) {
    const out = path.join(ctx.dir, `nar-${i}.wav`);
    padded.push(voice[i] ? await padTo(voice[i]!.file, durs[i], out, ctx.signal) : await silence(out, durs[i], ctx.signal));
  }
  const narration = await concatWavs(padded, path.join(ctx.dir, "narration.wav"), ctx.signal);
  let bed: string | null = null;
  if (opt.music !== "none") {
    try {
      bed = await musicBed({ music: opt.music, dur: total, out: path.join(ctx.dir, "music.wav"), lufs: voiced ? MUSIC_UNDER_LUFS : -16, signal: ctx.signal });
    } catch (e) {
      if (ctx.signal.aborted) throw new AbortedError();
      ctx.log(`Music skipped: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  const mix = path.join(ctx.dir, "mix.wav");
  if (!voiced && bed) await mixVoiceMusic({ voice: bed, music: null, lufs: -14, tp: -1, out: mix, outArgs: WAV_ARGS, signal: ctx.signal });
  else if (voiced) await mixVoiceMusic({ voice: narration, music: bed, lufs: -14, tp: -1, out: mix, outArgs: WAV_ARGS, signal: ctx.signal });
  else fs.copyFileSync(/*turbopackIgnore: true*/ narration, mix);

  // 6. captions
  let srt: string | null = null;
  if (opt.captions) {
    srt = buildSrt(
      plan.scenes.map((s, i) => ({
        start: starts[i],
        text: s.narration,
        voiced: voice[i]?.dur ?? Math.min(durs[i] - 0.3, wordCount(s.narration) / WORDS_PER_SEC),
      })),
    );
    if (!srt.trim()) srt = null;
  }

  // 7. join + burn + encode
  ctx.step(86, "Encoding final video");
  const inputs = clips.flatMap((c) => ["-i", c]);
  let graph = clips.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[c${i}];`).join("");
  let last = "c0";
  for (let i = 1; i < n; i++) {
    graph += `[${last}][c${i}]xfade=transition=fade:duration=${XFADE}:offset=${starts[i].toFixed(4)}[x${i}];`;
    last = `x${i}`;
  }
  const post: string[] = [];
  if (srt) {
    const srtFile = path.join(ctx.dir, "captions.srt");
    fs.writeFileSync(/*turbopackIgnore: true*/ srtFile, srt);
    post.push(`subtitles='${filterPath(srtFile)}':force_style='${captionStyle(aspect)}'`);
  }
  post.push(`fade=t=in:st=0:d=0.3`, `fade=t=out:st=${Math.max(0, total - 0.5).toFixed(3)}:d=0.5`, "format=yuv420p");
  graph += `[${last}]${post.join(",")}[v];[${n}:a]afade=t=out:st=${Math.max(0, total - 0.6).toFixed(3)}:d=0.6[a]`;
  const out = path.join(ctx.dir, "final.mp4");
  await ffmpeg(
    [...inputs, "-i", mix, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), "-r", String(FPS),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out],
    ctx.signal,
  );
  return { file: out, ext: ".mp4", srt };
}

// ---------------------------------------------------------------------------
// voiceover
// ---------------------------------------------------------------------------

async function produceVoiceover(ctx: Ctx, plan: VoiceoverPlan, opt: JobOptions): Promise<Produced> {
  const n = plan.segments.length;
  ctx.log(`Voiceover · ${n} segments · voice ${opt.tts}/${opt.voice ?? "default"} · music ${opt.music}`);
  const gap = await silence(path.join(ctx.dir, "gap.wav"), 0.35, ctx.signal);
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    ctx.signal.throwIfAborted();
    ctx.step(2 + (i / n) * 70, `Voicing segment ${i + 1}/${n}`);
    const s = await speak({ provider: opt.tts, voice: opt.voice, text: plan.segments[i].text, dir: ctx.dir, base: `seg-${i}`, signal: ctx.signal });
    if (i) parts.push(gap);
    parts.push(s.file);
    total += s.dur + (i ? 0.35 : 0);
  }
  ctx.step(74, "Joining segments");
  const voice = await concatWavs(parts, path.join(ctx.dir, "voice.wav"), ctx.signal);
  let bed: string | null = null;
  if (opt.music !== "none") {
    ctx.step(80, "Building music bed");
    try {
      bed = await musicBed({ music: opt.music, dur: total, out: path.join(ctx.dir, "music.wav"), lufs: MUSIC_UNDER_LUFS, signal: ctx.signal });
    } catch (e) {
      if (ctx.signal.aborted) throw new AbortedError();
      ctx.log(`Music skipped: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  ctx.step(88, "Mastering (loudnorm -16 LUFS) → mp3");
  const out = path.join(ctx.dir, "final.mp3");
  await mixVoiceMusic({ voice, music: bed, lufs: -16, tp: -1.5, out, outArgs: MP3_ARGS, signal: ctx.signal });
  return { file: out, ext: ".mp3" };
}

// ---------------------------------------------------------------------------
// podcast
// ---------------------------------------------------------------------------

async function producePodcast(ctx: Ctx, plan: PodcastPlan, opt: JobOptions): Promise<Produced> {
  const n = plan.lines.length;
  const voices = [opt.voice, opt.voice2 || opt.voice];
  ctx.log(`Podcast · ${n} lines · ${plan.hosts[0]}=${voices[0] ?? "default"}, ${plan.hosts[1]}=${voices[1] ?? "default"} · music ${opt.music}`);
  const gap = await silence(path.join(ctx.dir, "gap.wav"), 0.25, ctx.signal);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    ctx.signal.throwIfAborted();
    const line = plan.lines[i];
    ctx.step(2 + (i / n) * 76, `Voicing line ${i + 1}/${n} (${plan.hosts[line.speaker]})`);
    const s = await speak({ provider: opt.tts, voice: voices[line.speaker], text: line.text, dir: ctx.dir, base: `line-${i}`, signal: ctx.signal });
    if (i) parts.push(gap);
    parts.push(s.file);
  }
  ctx.step(80, "Joining dialogue");
  const dialogue = await concatWavs(parts, path.join(ctx.dir, "dialogue.wav"), ctx.signal);
  const dialogueNorm = path.join(ctx.dir, "dialogue-norm.wav");
  await mixVoiceMusic({ voice: dialogue, music: null, lufs: -16, tp: -1.5, out: dialogueNorm, outArgs: WAV_ARGS, signal: ctx.signal });
  let sequence = [dialogueNorm];
  if (opt.music !== "none") {
    ctx.step(86, "Building intro/outro sting");
    try {
      const sting = await musicBed({ music: opt.music, dur: 6, out: path.join(ctx.dir, "sting.wav"), lufs: -19, fadeIn: 0.4, fadeOut: 2.5, signal: ctx.signal });
      const pre = await silence(path.join(ctx.dir, "pre.wav"), 0.4, ctx.signal);
      const postGap = await silence(path.join(ctx.dir, "post.wav"), 0.6, ctx.signal);
      sequence = [sting, pre, dialogueNorm, postGap, sting];
    } catch (e) {
      if (ctx.signal.aborted) throw new AbortedError();
      ctx.log(`Music skipped: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  const joined = await concatWavs(sequence, path.join(ctx.dir, "episode.wav"), ctx.signal);
  ctx.step(92, "Mastering (loudnorm -16 LUFS) → mp3");
  const out = path.join(ctx.dir, "final.mp3");
  await mixVoiceMusic({ voice: joined, music: null, lufs: -16, tp: -1.5, out, outArgs: MP3_ARGS, signal: ctx.signal });
  return { file: out, ext: ".mp3" };
}

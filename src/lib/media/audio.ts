import "server-only";
import fs from "node:fs";
import path from "node:path";
import { mediaKind, mediaPath } from "../video";
import { durationOf, ffmpeg } from "./ff";
import { getTts } from "./providers";

/** Audio building blocks shared by the video, voiceover and podcast pipelines. */

export const SR = 48000;
const WAV = ["-ar", String(SR), "-ac", "2", "-c:a", "pcm_s16le"];
/** Music sits this far under the voice (LUFS), before sidechain ducking. */
export const MUSIC_UNDER_LUFS = -30;

export interface Spoken {
  file: string;
  dur: number;
}

/** TTS one chunk of text → 48 kHz stereo WAV. */
export async function speak(opts: { provider: string; voice?: string; text: string; dir: string; base: string; signal: AbortSignal }): Promise<Spoken> {
  const p = await getTts(opts.provider);
  const raw = path.join(opts.dir, `${opts.base}.raw.${p.format.replace(/[^a-z0-9]/gi, "") || "audio"}`);
  await p.synthesize({ text: opts.text, voice: opts.voice || undefined, outPath: raw, signal: opts.signal });
  const wav = path.join(opts.dir, `${opts.base}.wav`);
  await ffmpeg(["-i", raw, ...WAV, wav], opts.signal);
  fs.rmSync(/*turbopackIgnore: true*/ raw, { force: true });
  return { file: wav, dur: await durationOf(wav, opts.signal) };
}

export async function silence(file: string, dur: number, signal: AbortSignal) {
  await ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SR}:cl=stereo`, "-t", dur.toFixed(3), ...WAV, file], signal);
  return file;
}

/** Pad (or trim) a WAV to exactly `dur` seconds. */
export async function padTo(input: string, dur: number, out: string, signal: AbortSignal) {
  await ffmpeg(["-i", input, "-af", "apad", "-t", dur.toFixed(3), ...WAV, out], signal);
  return out;
}

/** Concatenate same-format WAVs with the concat demuxer (handles hundreds of parts). */
export async function concatWavs(files: string[], out: string, signal: AbortSignal) {
  const list = `${out}.txt`;
  fs.writeFileSync(/*turbopackIgnore: true*/ list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, ...WAV, out], signal);
  fs.rmSync(/*turbopackIgnore: true*/ list, { force: true });
  return out;
}

// Am – F – C/G – G, as [bass, three chord tones].
const CHORDS = [
  [110.0, 220.0, 261.63, 329.63],
  [87.31, 174.61, 220.0, 261.63],
  [98.0, 196.0, 261.63, 329.63],
  [98.0, 196.0, 246.94, 293.66],
];
const WINDOW = 8;

/**
 * Soft evolving pad: two layers whose sin² envelopes sum to a constant, each
 * changing chord only when its envelope is at zero (click-free, seamless for
 * any length). Detuned partials, lowpass and aecho for space.
 */
function ambientExpr(): string {
  const pick = (c: string, n: number) => `if(eq(${c},0),${CHORDS[0][n]},if(eq(${c},1),${CHORDS[1][n]},if(eq(${c},2),${CHORDS[2][n]},${CHORDS[3][n]})))`;
  const layer = (offset: number) => {
    const c = `mod(floor((t+${offset})/${WINDOW}),4)`;
    const env = `pow(sin(PI*(t+${offset})/${WINDOW}),2)`;
    const amps = [0.22, 0.12, 0.1, 0.08];
    const tones = amps
      .map((a, n) => `${a}*(sin(2*PI*${pick(c, n)}*t)+0.6*sin(2*PI*${pick(c, n)}*1.004*t))`)
      .join("+");
    return `${env}*(${tones})`;
  };
  return `${layer(0)}+${layer(WINDOW / 2)}`;
}

/**
 * Build a music bed of exactly `dur` seconds: "ambient" (generated) or a media
 * library audio/video file (looped). Normalized to `lufs`, faded in/out.
 */
export async function musicBed(opts: { music: string; dur: number; out: string; lufs: number; fadeIn?: number; fadeOut?: number; signal: AbortSignal }) {
  const { music, dur, out, lufs, signal } = opts;
  const fi = opts.fadeIn ?? 2;
  const fo = Math.min(opts.fadeOut ?? 3, dur / 2);
  const tail = `loudnorm=I=${lufs}:TP=-2:LRA=7,aresample=${SR},aformat=channel_layouts=stereo,afade=t=in:d=${fi},afade=t=out:st=${Math.max(0, dur - fo).toFixed(3)}:d=${fo.toFixed(3)}`;
  if (music === "ambient") {
    const graph = `aevalsrc='${ambientExpr()}':s=${SR}:d=${(dur + 0.5).toFixed(3)},lowpass=f=1500,aecho=0.8:0.55:140|260:0.3|0.2,pan=stereo|c0=c0|c1=c0,${tail}[out]`;
    await ffmpeg(["-filter_complex", graph, "-map", "[out]", "-t", dur.toFixed(3), ...WAV, out], signal);
    return out;
  }
  const file = mediaPath(music);
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) throw new Error(`Music file not found: ${music}`);
  if (mediaKind(music) === "image") throw new Error(`Music must be an audio or video file: ${music}`);
  await ffmpeg(["-stream_loop", "-1", "-i", file, "-vn", "-af", tail, "-t", dur.toFixed(3), ...WAV, out], signal);
  return out;
}

/**
 * Normalize the voice, duck the music under it with sidechaincompress, then
 * loudnorm the mix. `outArgs` picks the container/codec of `out`.
 */
export async function mixVoiceMusic(opts: { voice: string; music: string | null; lufs: number; tp: number; out: string; outArgs: string[]; signal: AbortSignal }) {
  const { voice, music, out, signal } = opts;
  const final = `loudnorm=I=${opts.lufs}:TP=${opts.tp}:LRA=11,aresample=${SR},aformat=channel_layouts=stereo`;
  if (!music) {
    await ffmpeg(["-i", voice, "-af", final, ...opts.outArgs, out], signal);
    return out;
  }
  const graph =
    `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=${SR},aformat=channel_layouts=stereo,asplit=2[v][sc];` +
    `[1:a][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck];` +
    `[v][duck]amix=inputs=2:duration=first:normalize=0,${final}[a]`;
  await ffmpeg(["-i", voice, "-i", music, "-filter_complex", graph, "-map", "[a]", ...opts.outArgs, out], signal);
  return out;
}

export const WAV_ARGS = WAV;
export const MP3_ARGS = ["-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100"];

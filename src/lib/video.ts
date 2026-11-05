import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MEDIA_DIR } from "./db";

export const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|gif|jpg|jpeg|png)$/i;

export interface MediaFile {
  name: string;
  size: number;
  modified: number;
  kind: "video" | "audio" | "image";
}

export function mediaKind(name: string): MediaFile["kind"] {
  if (/\.(mp3|wav|m4a|aac)$/i.test(name)) return "audio";
  if (/\.(gif|jpg|jpeg|png)$/i.test(name)) return "image";
  return "video";
}

/** Resolve a bare media file name inside MEDIA_DIR; rejects traversal. */
export function mediaPath(name: string): string {
  const base = path.basename(name);
  if (base !== name || !MEDIA_EXT.test(base)) throw new Error(`Invalid media name: ${name}`);
  return path.join(MEDIA_DIR, base);
}

export function safeMediaName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const stem = path
    .basename(original, path.extname(original))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "media";
  let name = `${stem}${ext}`;
  let i = 1;
  while (fs.existsSync(path.join(MEDIA_DIR, name))) name = `${stem}-${i++}${ext}`;
  return name;
}

export function listMedia(): MediaFile[] {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  return fs
    .readdirSync(MEDIA_DIR)
    .filter((n) => MEDIA_EXT.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(MEDIA_DIR, name));
      return { name, size: st.size, modified: st.mtimeMs, kind: mediaKind(name) };
    })
    .sort((a, b) => b.modified - a.modified);
}

// ---------------------------------------------------------------------------
// Operations — a closed set with validated params (no raw ffmpeg from users/AI)
// ---------------------------------------------------------------------------

const time = z.number().min(0).max(36000);

export const VideoOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim"), start: time, end: time }),
  z.object({ op: z.literal("concat"), others: z.array(z.string()).min(1).max(20) }),
  z.object({ op: z.literal("reframe"), aspect: z.enum(["9:16", "1:1", "16:9", "4:5"]), mode: z.enum(["crop", "pad"]).default("crop") }),
  z.object({
    op: z.literal("text"),
    text: z.string().min(1).max(300),
    position: z.enum(["top", "center", "bottom"]).default("bottom"),
    fontSize: z.number().int().min(12).max(200).default(56),
    start: time.optional(),
    end: time.optional(),
  }),
  z.object({ op: z.literal("captions"), srt: z.string().min(1).max(200_000) }),
  z.object({ op: z.literal("speed"), factor: z.number().min(0.25).max(4) }),
  z.object({ op: z.literal("mute") }),
  z.object({ op: z.literal("extractAudio") }),
  z.object({ op: z.literal("compress"), crf: z.number().int().min(18).max(36).default(28), maxWidth: z.number().int().min(320).max(3840).default(1920) }),
  z.object({ op: z.literal("thumbnail"), at: time.default(1) }),
  z.object({ op: z.literal("gif"), start: time.default(0), duration: z.number().min(0.5).max(30).default(5), width: z.number().int().min(120).max(1280).default(480) }),
  z.object({ op: z.literal("fade"), fadeIn: z.number().min(0).max(10).default(0.5), fadeOut: z.number().min(0).max(10).default(0.5) }),
]);

export type VideoOp = z.infer<typeof VideoOpSchema>;

export const VIDEO_OP_DOCS = `Available operations (JSON objects, applied in order, each to the previous result):
- {"op":"trim","start":sec,"end":sec}
- {"op":"concat","others":["file2.mp4", ...]}   // append other media files from the library
- {"op":"reframe","aspect":"9:16"|"1:1"|"16:9"|"4:5","mode":"crop"|"pad"}
- {"op":"text","text":"...","position":"top"|"center"|"bottom","fontSize":56,"start":sec?,"end":sec?}
- {"op":"captions","srt":"<full SRT file content>"}
- {"op":"speed","factor":0.25-4}
- {"op":"fade","fadeIn":sec,"fadeOut":sec}
- {"op":"mute"}
- {"op":"compress","crf":18-36,"maxWidth":1920}
- {"op":"extractAudio"}   // outputs .mp3, must be last
- {"op":"thumbnail","at":sec}   // outputs .jpg, must be last
- {"op":"gif","start":sec,"duration":sec,"width":480}   // outputs .gif, must be last`;

export interface Probe {
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  fps: number | null;
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    child.on("error", (e) => reject(new Error(`${cmd} failed to start: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}\n${stderr.split("\n").slice(-12).join("\n")}`))));
  });
}

export async function probe(name: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mediaPath(name)]);
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration ?? 0),
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === "audio")),
    videoCodec: v?.codec_name ?? null,
    fps: den ? Math.round((num / den) * 100) / 100 : null,
  };
}

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

function fontFile(): string | null {
  return FONT_CANDIDATES.find((f) => fs.existsSync(f)) ?? null;
}

/** Escape a filesystem path for use inside an ffmpeg filter argument. */
function filterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];

function atempoChain(f: number): string {
  const parts: string[] = [];
  let r = f;
  while (r > 2) { parts.push("atempo=2.0"); r /= 2; }
  while (r < 0.5) { parts.push("atempo=0.5"); r /= 0.5; }
  parts.push(`atempo=${r.toFixed(4)}`);
  return parts.join(",");
}

const ASPECTS: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080], "4:5": [1080, 1350] };

/** Applies one op to `input` (a media name) and returns the output media name. */
export async function applyOp(input: string, op: VideoOp, tmpFiles: string[]): Promise<string> {
  const inPath = mediaPath(input);
  const stem = path.basename(input, path.extname(input)).replace(/-(rex\d+)$/, "");
  const outExt = op.op === "extractAudio" ? ".mp3" : op.op === "thumbnail" ? ".jpg" : op.op === "gif" ? ".gif" : ".mp4";
  const outName = safeMediaName(`${stem}-${op.op}${outExt}`);
  const outPath = path.join(MEDIA_DIR, outName);
  const info = await probe(input);
  const args: string[] = ["-y", "-hide_banner"];

  switch (op.op) {
    case "trim": {
      if (op.end <= op.start) throw new Error("trim: end must be after start");
      args.push("-ss", String(op.start), "-to", String(op.end), "-i", inPath, ...ENC, outPath);
      break;
    }
    case "concat": {
      const all = [input, ...op.others];
      const W = info.width ?? 1920;
      const H = info.height ?? 1080;
      const probes = await Promise.all(all.map((n) => probe(n)));
      const inputs: string[] = [];
      let graph = "";
      all.forEach((n, i) => {
        inputs.push("-i", mediaPath(n));
        graph += `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];`;
      });
      // Inputs without audio get generated silence so concat stays aligned.
      all.forEach((_, i) => {
        if (probes[i].hasAudio) graph += `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`;
        else graph += `anullsrc=r=48000:cl=stereo,atrim=duration=${probes[i].duration}[a${i}];`;
      });
      graph += all.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${all.length}:v=1:a=1[v][a]`;
      args.push(...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", ...ENC, outPath);
      break;
    }
    case "reframe": {
      const [W, H] = ASPECTS[op.aspect];
      const vf =
        op.mode === "crop"
          ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
          : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      args.push("-i", inPath, "-vf", vf, ...ENC, outPath);
      break;
    }
    case "text": {
      const font = fontFile();
      const txt = path.join(MEDIA_DIR, `.tmp-${randomUUID()}.txt`);
      fs.writeFileSync(txt, op.text);
      tmpFiles.push(txt);
      const y = op.position === "top" ? "h*0.08" : op.position === "center" ? "(h-text_h)/2" : "h*0.82-text_h";
      const enable = op.start !== undefined || op.end !== undefined ? `:enable='between(t,${op.start ?? 0},${op.end ?? info.duration})'` : "";
      const vf = `drawtext=${font ? `fontfile='${filterPath(font)}':` : ""}textfile='${filterPath(txt)}':fontsize=${op.fontSize}:fontcolor=white:borderw=4:bordercolor=black@0.85:x=(w-text_w)/2:y=${y}${enable}`;
      args.push("-i", inPath, "-vf", vf, ...ENC, outPath);
      break;
    }
    case "captions": {
      const srt = path.join(MEDIA_DIR, `.tmp-${randomUUID()}.srt`);
      fs.writeFileSync(srt, op.srt);
      tmpFiles.push(srt);
      const vf = `subtitles='${filterPath(srt)}':force_style='FontName=Arial,Bold=1,FontSize=16,Outline=2,MarginV=40'`;
      args.push("-i", inPath, "-vf", vf, ...ENC, outPath);
      break;
    }
    case "speed": {
      args.push("-i", inPath, "-filter:v", `setpts=PTS/${op.factor}`);
      if (info.hasAudio) args.push("-filter:a", atempoChain(op.factor));
      args.push(...ENC, outPath);
      break;
    }
    case "fade": {
      const d = info.duration;
      const vf = [op.fadeIn > 0 ? `fade=t=in:st=0:d=${op.fadeIn}` : "", op.fadeOut > 0 ? `fade=t=out:st=${Math.max(0, d - op.fadeOut)}:d=${op.fadeOut}` : ""].filter(Boolean).join(",") || "null";
      const af = [op.fadeIn > 0 ? `afade=t=in:st=0:d=${op.fadeIn}` : "", op.fadeOut > 0 ? `afade=t=out:st=${Math.max(0, d - op.fadeOut)}:d=${op.fadeOut}` : ""].filter(Boolean).join(",") || "anull";
      args.push("-i", inPath, "-vf", vf);
      if (info.hasAudio) args.push("-af", af);
      args.push(...ENC, outPath);
      break;
    }
    case "mute":
      args.push("-i", inPath, "-an", "-c:v", "copy", outPath);
      break;
    case "extractAudio":
      if (!info.hasAudio) throw new Error("extractAudio: input has no audio track");
      args.push("-i", inPath, "-vn", "-c:a", "libmp3lame", "-q:a", "2", outPath);
      break;
    case "compress":
      args.push("-i", inPath, "-vf", `scale='min(${op.maxWidth},iw)':-2`, "-c:v", "libx264", "-preset", "medium", "-crf", String(op.crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath);
      break;
    case "thumbnail":
      args.push("-ss", String(Math.min(op.at, Math.max(0, info.duration - 0.1))), "-i", inPath, "-frames:v", "1", "-q:v", "2", outPath);
      break;
    case "gif":
      args.push("-ss", String(op.start), "-t", String(op.duration), "-i", inPath, "-vf", `fps=12,scale=${op.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, outPath);
      break;
  }

  await run("ffmpeg", args);
  return outName;
}

export interface PipelineResult {
  outputs: string[];
  final: string;
}

/** Runs ops sequentially, each on the previous output. Intermediate files are kept so every step is reviewable. */
export async function runPipeline(input: string, ops: VideoOp[]): Promise<PipelineResult> {
  const tmp: string[] = [];
  const outputs: string[] = [];
  let current = input;
  try {
    for (const op of ops) {
      current = await applyOp(current, op, tmp);
      outputs.push(current);
    }
  } finally {
    for (const f of tmp) fs.rmSync(f, { force: true });
  }
  return { outputs, final: current };
}

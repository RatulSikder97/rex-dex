import fs from "node:fs";
import { Readable } from "node:stream";
import { fail, handle, ok } from "@/lib/http";
import { mediaPath, probe } from "@/lib/video";

type Ctx = { params: Promise<{ name: string }> };

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};

/** Serves media with HTTP Range support (required for <video> seeking). `?probe=1` returns ffprobe info. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const name = decodeURIComponent((await params).name);
  const file = mediaPath(name);
  if (!fs.existsSync(file)) return fail("Not found", 404);
  const url = new URL(req.url);
  if (url.searchParams.get("probe")) return ok(await probe(name));

  const size = fs.statSync(file).size;
  const type = MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
  const disposition: Record<string, string> = url.searchParams.get("download") ? { "content-disposition": `attachment; filename="${name}"` } : {};
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", ...disposition },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes", ...disposition } });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const file = mediaPath(decodeURIComponent((await params).name));
  fs.rmSync(file, { force: true });
  return ok({ ok: true });
});

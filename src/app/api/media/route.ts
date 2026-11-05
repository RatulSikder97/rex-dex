import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "@/lib/db";
import { fail, handle, ok } from "@/lib/http";
import { listMedia, MEDIA_EXT, safeMediaName } from "@/lib/video";

export const GET = handle(async () => ok(listMedia()));

/** Multipart upload: field "file" (one or more). */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return fail("No file uploaded");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const saved: string[] = [];
  for (const file of files) {
    if (!MEDIA_EXT.test(file.name)) return fail(`Unsupported file type: ${file.name}`);
    const name = safeMediaName(file.name);
    fs.writeFileSync(path.join(MEDIA_DIR, name), Buffer.from(await file.arrayBuffer()));
    saved.push(name);
  }
  return ok({ saved }, { status: 201 });
});

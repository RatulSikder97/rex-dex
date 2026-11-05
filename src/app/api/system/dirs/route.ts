import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createDir, listDirs } from "@/lib/system";

export const dynamic = "force-dynamic";

/** GET /api/system/dirs?path= → folders inside a directory (for the in-app folder explorer). */
export const GET = handle(async (req: Request) => ok(listDirs(new URL(req.url).searchParams.get("path"))));

const Mk = z.object({ parent: z.string().min(1).max(1000), name: z.string().min(1).max(120) });

/** POST {parent, name} → creates a new folder (New Folder in the explorer). */
export const POST = handle(async (req: Request) => {
  const { parent, name } = await body(req, Mk);
  return ok({ path: createDir(parent, name) });
});

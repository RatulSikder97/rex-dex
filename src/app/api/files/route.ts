import { z } from "zod";
import { fileOp, listAllFiles, listDir, readFile, writeFile } from "@/lib/fsx";
import { body, fail, handle, ok } from "@/lib/http";
import { getProject } from "@/lib/repo";

function rootFor(projectId: string | null): string | null {
  if (!projectId) return null;
  return getProject(projectId)?.repo_path || null;
}

/** GET ?mode=read&path → file contents; ?mode=all → every file path; default → directory listing. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const root = rootFor(sp.get("projectId"));
  if (!root) return fail("Project has no repo path. Set one in project settings.", 400);
  const rel = sp.get("path") ?? "";
  const mode = sp.get("mode");
  if (mode === "read") return ok(readFile(root, rel));
  if (mode === "all") return ok(await listAllFiles(root));
  return ok(listDir(root, rel));
});

const WriteSchema = z.object({ projectId: z.string(), path: z.string().min(1), content: z.string().max(5_000_000) });

export const PUT = handle(async (req: Request) => {
  const input = await body(req, WriteSchema);
  const root = rootFor(input.projectId);
  if (!root) return fail("Project has no repo path", 400);
  writeFile(root, input.path, input.content);
  return ok({ ok: true });
});

const OpSchema = z.object({
  projectId: z.string(),
  op: z.enum(["create", "mkdir", "rename", "delete"]),
  path: z.string().trim().min(1).max(4096),
  to: z.string().trim().min(1).max(4096).optional(),
});

/** POST {projectId, op: create|mkdir|rename|delete, path, to?} → file-system operation inside the repo. */
export const POST = handle(async (req: Request) => {
  const input = await body(req, OpSchema);
  const root = rootFor(input.projectId);
  if (!root) return fail("Project has no repo path", 400);
  if (input.op === "rename" && !input.to) return fail("rename requires `to`", 400);
  try {
    fileOp(root, input.op, input.path, input.to);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok({ ok: true });
});

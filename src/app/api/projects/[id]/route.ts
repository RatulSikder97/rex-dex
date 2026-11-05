import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { deleteProject, getProject, updateProject } from "@/lib/repo";
import { STAGES } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const p = getProject((await params).id);
  return p ? ok(p) : fail("Project not found", 404);
});

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(5000).optional(),
  stage: z.enum(STAGES).optional(),
  repo_path: z.string().max(1000).optional(),
  website_url: z.string().max(1000).optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const p = updateProject((await params).id, await body(req, PatchSchema));
  return p ? ok(p) : fail("Project not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  deleteProject((await params).id);
  return ok({ ok: true });
});

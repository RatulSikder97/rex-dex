import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { deleteTask, updateTask } from "@/lib/repo";
import { PRIORITIES, TASK_STATUSES } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  detail: z.string().max(10000).optional(),
  department: z.string().max(40).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  position: z.number().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const t = updateTask((await params).id, await body(req, PatchSchema));
  return t ? ok(t) : fail("Task not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  deleteTask((await params).id);
  return ok({ ok: true });
});

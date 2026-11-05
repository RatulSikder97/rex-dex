import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { createTasks, getProject, listTasks } from "@/lib/repo";
import { PRIORITIES, TASK_STATUSES } from "@/lib/types";

export const GET = handle(async (req: Request) => {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
  return ok(listTasks(projectId));
});

const TaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().max(10000).optional(),
  department: z.string().max(40).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

const CreateSchema = z.object({ projectId: z.string(), tasks: z.array(TaskInput).min(1).max(200) });

export const POST = handle(async (req: Request) => {
  const input = await body(req, CreateSchema);
  if (!getProject(input.projectId)) return fail("Project not found", 404);
  return ok(createTasks(input.projectId, input.tasks), { status: 201 });
});

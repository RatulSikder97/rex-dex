import { z } from "zod";
import { allDepartments } from "@/lib/plugins/registry";
import { body, fail, handle, ok } from "@/lib/http";
import { createTasks, getProject } from "@/lib/repo";
import { extractJson, runToText } from "@/lib/runs";
import { PRIORITIES } from "@/lib/types";

export const maxDuration = 600;

const PlanSchema = z.object({
  projectId: z.string(),
  goal: z.string().trim().min(1).max(20_000),
  provider: z.string().max(40).nullish(),
});

function generatedTasksSchema(deptIds: [string, ...string[]]) {
  return z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        detail: z.string().max(10000).default(""),
        department: z.enum(deptIds).catch("engineering"),
        priority: z.enum(PRIORITIES).catch("medium"),
      }),
    )
    .min(1)
    .max(60),
  });
}

/** Turns a goal into a cross-department task breakdown and inserts it into the board backlog. */
export const POST = handle(async (req: Request) => {
  const input = await body(req, PlanSchema);
  if (!getProject(input.projectId)) return fail("Project not found", 404);

  const departments = allDepartments();
  const GeneratedTasks = generatedTasksSchema(departments.map((d) => d.id) as [string, ...string[]]);
  const brief = `Break the following goal into an executable plan of tasks across departments, from planning through production to marketing.
Departments (use these exact ids): ${departments.map((d) => `${d.id} (${d.role})`).join("; ")}.
Each task must be concrete and completable in under a day by one department agent. Order tasks in execution order. 8-30 tasks.
Respond with ONLY a JSON object, no prose: {"tasks":[{"title":"...","detail":"acceptance criteria / specifics","department":"<id>","priority":"low|medium|high|urgent"}]}

Goal: ${input.goal}`;

  const text = await runToText({ department: "ceo", provider: input.provider, brief, projectId: input.projectId });
  const parsed = GeneratedTasks.parse(extractJson(text));
  const created = createTasks(input.projectId, parsed.tasks.map((t) => ({ ...t, status: "backlog" as const })));
  return ok(created, { status: 201 });
});

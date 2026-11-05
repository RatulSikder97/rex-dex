import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createSwarm, listSwarms } from "@/lib/swarms";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => ok(listSwarms(new URL(req.url).searchParams.get("projectId"))));

const Create = z.object({
  projectId: z.string().nullish(),
  taskId: z.string().nullish(),
  goal: z.string().max(20_000).default(""),
  maxParallel: z.number().int().min(1).max(6).optional(),
  allowEdits: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  departments: z.array(z.string().max(40)).max(30).optional(),
});

/** POST: the Chief of Staff plans the swarm (status "planning" → "planned"; autoStart runs it right away). */
export const POST = handle(async (req: Request) => {
  const input = await body(req, Create);
  if (!input.goal.trim() && !input.taskId) throw new Error("Give the swarm a goal or a task");
  return ok(await createSwarm(input), { status: 201 });
});

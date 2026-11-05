import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { listRuns } from "@/lib/repo";
import { startRun } from "@/lib/runs";

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  return ok(
    listRuns({
      projectId: sp.get("projectId") ?? undefined,
      threadId: sp.get("threadId") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    }),
  );
});

const StartSchema = z.object({
  department: z.string().min(1).max(40),
  provider: z.string().max(40).nullish(),
  brief: z.string().trim().min(1).max(100_000),
  projectId: z.string().nullish(),
  taskId: z.string().nullish(),
  threadId: z.string().max(80).nullish(),
  model: z.string().max(100).nullish(),
  allowEdits: z.boolean().optional(),
  context: z.string().max(400_000).optional(),
});

export const POST = handle(async (req: Request) => ok(await startRun(await body(req, StartSchema)), { status: 201 }));

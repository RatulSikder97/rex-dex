import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createDeliverable, listDeliverables } from "@/lib/repo";

export const GET = handle(async (req: Request) => ok(listDeliverables(new URL(req.url).searchParams.get("projectId") ?? undefined)));

const CreateSchema = z.object({
  project_id: z.string().nullable(),
  run_id: z.string().nullish(),
  department: z.string().max(40),
  kind: z.enum(["markdown", "svg", "html", "json"]),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(5_000_000),
});

export const POST = handle(async (req: Request) => ok(createDeliverable(await body(req, CreateSchema)), { status: 201 }));

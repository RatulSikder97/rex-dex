import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { deleteDeliverable, getDeliverable, updateDeliverable } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const d = getDeliverable((await params).id);
  return d ? ok(d) : fail("Deliverable not found", 404);
});

const PatchSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), content: z.string().max(5_000_000).optional() });

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const d = updateDeliverable((await params).id, await body(req, PatchSchema));
  return d ? ok(d) : fail("Deliverable not found", 404);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  deleteDeliverable((await params).id);
  return ok({ ok: true });
});

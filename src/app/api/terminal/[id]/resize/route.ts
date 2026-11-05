import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { resizeTerminal } from "@/lib/terminal";

type Ctx = { params: Promise<{ id: string }> };

const ResizeSchema = z.object({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) });

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { cols, rows } = await body(req, ResizeSchema);
  return resizeTerminal((await params).id, cols, rows) ? ok({ ok: true }) : fail("Terminal not found or exited", 404);
});

import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { writeTerminal } from "@/lib/terminal";

type Ctx = { params: Promise<{ id: string }> };

const InputSchema = z.object({ data: z.string().max(1_000_000) });

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { data } = await body(req, InputSchema);
  return writeTerminal((await params).id, data) ? ok({ ok: true }) : fail("Terminal not found or exited", 404);
});

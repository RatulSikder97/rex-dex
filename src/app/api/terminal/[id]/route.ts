import { fail, handle, ok } from "@/lib/http";
import { killTerminal } from "@/lib/terminal";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  return killTerminal((await params).id) ? ok({ ok: true }) : fail("Terminal not found", 404);
});

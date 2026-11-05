import { fail, handle, ok } from "@/lib/http";
import { getRun } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const r = getRun((await params).id);
  return r ? ok(r) : fail("Run not found", 404);
});

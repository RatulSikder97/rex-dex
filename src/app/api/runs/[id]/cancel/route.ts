import { handle, ok } from "@/lib/http";
import { cancelRun } from "@/lib/runs";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => ok({ cancelled: cancelRun((await params).id) }));

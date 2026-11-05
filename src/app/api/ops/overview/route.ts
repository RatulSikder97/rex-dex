import { handle, ok } from "@/lib/http";
import { opsOverview } from "@/lib/ops/overview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => ok(await opsOverview(new URL(req.url).searchParams.get("projectId"))));

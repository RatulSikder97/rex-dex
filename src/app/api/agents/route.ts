import { agentStatuses } from "@/lib/ai/agents";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/agents[?refresh=1] → terminal AI agents (built-in + extensions) with install/login status. */
export const GET = handle(async (req: Request) => ok(await agentStatuses(new URL(req.url).searchParams.has("refresh"))));

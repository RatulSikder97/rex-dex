import { listConnections } from "@/lib/connections";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/connections[?refresh=1] → every third-party connection (installed or in the catalog) with status. */
export const GET = handle(async (req: Request) => ok(await listConnections(new URL(req.url).searchParams.has("refresh"))));

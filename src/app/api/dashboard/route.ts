import { handle, ok } from "@/lib/http";
import { dashboardStats, listRuns } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handle(async () => ok({ ...dashboardStats(), recentRuns: listRuns({ limit: 12 }) }));

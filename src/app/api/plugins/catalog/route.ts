import { handle, ok } from "@/lib/http";
import { catalog } from "@/lib/plugins/registry";

export const dynamic = "force-dynamic";

export const GET = handle(async () => ok(await catalog()));

import { handle, ok } from "@/lib/http";
import { sshConfigHosts } from "@/lib/ops/servers";

export const dynamic = "force-dynamic";

export const GET = handle(async () => ok(sshConfigHosts()));

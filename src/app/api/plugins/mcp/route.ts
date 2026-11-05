import { handle, ok } from "@/lib/http";
import { allMcpServers } from "@/lib/plugins/registry";

export const dynamic = "force-dynamic";

/** MCP servers from enabled extensions (env values redacted). */
export const GET = handle(async () =>
  ok(allMcpServers().map((s) => ({ name: s.name, pluginId: s.pluginId, command: s.command, args: s.args, envKeys: Object.keys(s.env), missing: s.missing }))),
);

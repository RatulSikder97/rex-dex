import path from "node:path";
import { z } from "zod";
import { clearConnectionChecks, connectionServer, getConnection, markConnection, withRexBin } from "@/lib/connections";
import { activeCliLogin, startCliLogin } from "@/lib/oauth/cliLogin";
import { disconnectOAuth, oauthStatus, startOAuth } from "@/lib/oauth/mcpOAuth";
import { body, fail, handle, ok } from "@/lib/http";
import { assertVideo, exportAeScript, exportFcpXml, openWithApp, runInAfterEffects } from "@/lib/media/nle";
import { startRun } from "@/lib/runs";
import { mediaPath } from "@/lib/video";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark-connected") }),
  /** Browser sign-in: OAuth (returns the provider URL to open) or a CLI login run in the background. */
  z.object({ action: z.literal("connect") }),
  z.object({ action: z.literal("connect-status") }),
  z.object({ action: z.literal("disconnect") }),
  /** Ask the department's agent to list the connection's tools: proves it's wired up. */
  z.object({ action: z.literal("test"), projectId: z.string().nullish() }),
  z.object({ action: z.literal("open-media"), media: z.string().max(255) }),
  z.object({ action: z.literal("export-fcpxml"), media: z.string().max(255), open: z.boolean().default(true) }),
  z.object({ action: z.literal("export-ae-jsx"), media: z.string().max(255), open: z.boolean().default(true) }),
]);

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const input = await body(req, Schema);
  const c = await getConnection(id);
  if (!c) return fail("Unknown connection", 404);

  switch (input.action) {
    case "mark-connected":
      markConnection(id, true);
      return ok({ ok: true });
    case "disconnect":
      markConnection(id, false);
      if (c.auth === "oauth") disconnectOAuth(id);
      return ok({ ok: true });
    case "connect": {
      if (c.auth === "oauth") {
        const srv = connectionServer(c);
        if (!srv?.url) return fail("Install and enable this connection first", 400);
        const origin = new URL(req.url).origin;
        try {
          return ok({ kind: "oauth", url: await startOAuth(id, srv.url, origin) });
        } catch (e) {
          // Provider only allows approved apps (no dynamic registration): sign in through the agent instead.
          return ok({ kind: "agent", reason: e instanceof Error ? e.message : String(e) });
        }
      }
      if (c.auth === "browser-cli" && c.authCommand) {
        const job = startCliLogin(id, withRexBin(c.authCommand), clearConnectionChecks);
        return ok({ kind: "cli", job });
      }
      if (c.auth === "agent-oauth") return ok({ kind: "agent", reason: `${c.name} only allows approved apps, so sign-in runs through Claude Code` });
      return fail(`${c.name} doesn't sign in through the browser`, 400);
    }
    case "connect-status":
      return ok({ job: activeCliLogin(id) ?? null, connected: c.auth === "oauth" ? oauthStatus(id).connected : c.status === "connected" });
    case "test": {
      const srv = connectionServer(c);
      if (!srv) return fail("Install and enable this connection first", 400);
      const department = c.departments[0] ?? "ceo";
      const run = await startRun({
        department,
        provider: "claude-cli",
        projectId: input.projectId ?? null,
        brief: `Connection check for "${c.name}". Using ONLY the MCP server named "${srv.name}", list the names of the tools it gives you, comma-separated, on one line. Do not call any tool. If that server isn't available or needs sign-in, reply exactly: NOT CONNECTED — <reason>.`,
      });
      return ok(run);
    }
    default: {
      if (c.kind !== "app" || !c.actions.includes(input.action)) return fail(`${c.name} doesn't support ${input.action}`, 400);
      const opening = input.action === "open-media" || input.open;
      // Exports work without the app (download the XML / script); opening needs it installed.
      if (opening && !c.appPath) return fail(`${c.name} isn't installed on this Mac`, 400);
      const file = mediaPath(input.media);
      if (input.action === "open-media") {
        await openWithApp(c.appPath!, file);
        return ok({ file, opened: true });
      }
      assertVideo(input.media);
      if (input.action === "export-fcpxml") {
        const out = await exportFcpXml(input.media);
        if (input.open) await openWithApp(c.appPath!, out);
        return ok({ file: out, name: path.basename(out), opened: input.open });
      }
      const out = await exportAeScript(input.media);
      if (input.open) await runInAfterEffects(c.appPath!, out);
      return ok({ file: out, name: path.basename(out), opened: input.open });
    }
  }
});

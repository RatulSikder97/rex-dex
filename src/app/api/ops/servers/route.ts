import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createServer, HOST_RE, listServers, LOG_RE, USER_RE } from "@/lib/ops/servers";

export const dynamic = "force-dynamic";

const ServerSchema = z.object({
  projectId: z.string().nullish(),
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().regex(HOST_RE, "Host: letters, digits, dots, dashes (or an ~/.ssh/config alias)"),
  user: z.string().trim().regex(USER_RE).or(z.literal("")).nullish(),
  port: z.number().int().min(1).max(65535).nullish(),
  identityFile: z.string().trim().max(400).regex(/^[~/][\w./~-]*$/).or(z.literal("")).nullish(),
  logPath: z.string().trim().regex(LOG_RE).or(z.literal("")).nullish(),
});

export const GET = handle(async (req: Request) => ok(listServers(new URL(req.url).searchParams.get("projectId"))));
export const POST = handle(async (req: Request) => ok(createServer(await body(req, ServerSchema)), { status: 201 }));

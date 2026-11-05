import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { deleteServer, HOST_RE, LOG_RE, updateServer, USER_RE } from "@/lib/ops/servers";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  host: z.string().trim().regex(HOST_RE).optional(),
  user: z.string().trim().regex(USER_RE).or(z.literal("")).nullish(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().trim().max(400).regex(/^[~/][\w./~-]*$/).or(z.literal("")).nullish(),
  logPath: z.string().trim().regex(LOG_RE).or(z.literal("")).nullish(),
});

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const s = updateServer(id, await body(req, Patch));
  return s ? ok(s) : fail("Server not found", 404);
});

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  deleteServer((await ctx.params).id);
  return ok({ ok: true });
});

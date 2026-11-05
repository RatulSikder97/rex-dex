import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { listInstalled, uninstallPlugin, updatePluginState } from "@/lib/plugins/registry";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = listInstalled().find((x) => x.manifest.id === id);
  return p ? ok(p) : fail("Extension not installed", 404);
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  updatePluginState(id, await body(req, z.object({ enabled: z.boolean().optional(), trusted: z.boolean().optional() })));
  return ok(listInstalled().find((x) => x.manifest.id === id) ?? null);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  uninstallPlugin((await params).id);
  return ok({ ok: true });
});

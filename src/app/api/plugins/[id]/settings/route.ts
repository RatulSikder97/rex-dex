import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { setPluginSetting } from "@/lib/plugins/registry";

type Ctx = { params: Promise<{ id: string }> };

/** Write-only: setting values (API keys) are never returned to the client. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { key, value } = await body(req, z.object({ key: z.string().min(1).max(60), value: z.string().max(5000) }));
  setPluginSetting(id, key, value);
  return ok({ ok: true });
});

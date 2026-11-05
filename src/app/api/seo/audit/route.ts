import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { auditUrl } from "@/lib/seo";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const { url } = await body(req, z.object({ url: z.string().trim().min(3).max(2000) }));
  return ok(await auditUrl(url));
});

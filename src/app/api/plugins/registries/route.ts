import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { getRegistries, setRegistries } from "@/lib/plugins/registry";

export const GET = handle(async () => ok(getRegistries()));

export const PUT = handle(async (req: Request) => {
  const { urls } = await body(req, z.object({ urls: z.array(z.string().url().max(500)).max(20) }));
  setRegistries(urls);
  return ok(getRegistries());
});

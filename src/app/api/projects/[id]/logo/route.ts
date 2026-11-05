import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { generateLogoOptions, setProjectLogo } from "@/lib/logo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Gen = z.object({ hint: z.string().max(500).optional() });

/** POST {hint?} → { options: svg[] } drafted by the Design agent (not saved yet). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { hint } = await body(req, Gen);
  return ok({ options: await generateLogoOptions((await ctx.params).id, hint) });
});

const Set = z.object({ svg: z.string().max(600_000) });

/** PUT {svg} → saves the chosen / uploaded logo ("" clears it). */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { svg } = await body(req, Set);
  return ok(setProjectLogo((await ctx.params).id, svg));
});

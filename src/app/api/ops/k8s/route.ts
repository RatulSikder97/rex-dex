import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { k8sAction, k8sInfo } from "@/lib/ops/containers";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  return ok(await k8sInfo(sp.get("context"), sp.get("namespace")));
});

const Action = z.object({
  context: z.string().min(1).max(253),
  namespace: z.string().min(1).max(253),
  kind: z.enum(["pod", "deployment"]),
  name: z.string().min(1).max(253),
  action: z.enum(["logs", "restart", "scale"]),
  replicas: z.number().int().min(0).max(100).optional(),
});

export const POST = handle(async (req: Request) => ok({ ok: true, output: await k8sAction(await body(req, Action)) }));

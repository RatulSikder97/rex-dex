import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { createMonitor, listMonitors } from "@/lib/ops/monitors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => ok(listMonitors(new URL(req.url).searchParams.get("projectId"))));

const Create = z.object({ projectId: z.string().nullish(), name: z.string().trim().min(1).max(80), url: z.string().trim().url().max(500) });

export const POST = handle(async (req: Request) => ok(await createMonitor(await body(req, Create)), { status: 201 }));

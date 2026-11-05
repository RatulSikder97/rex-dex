import { z } from "zod";
import { getAgentPrefs, setAgentPrefs } from "@/lib/ai/agents";
import { body, handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const AgentId = z.string().regex(/^[a-z0-9-]{2,40}$/);

const PrefsSchema = z.object({
  defaultAgent: AgentId,
  departments: z.record(z.string().max(40), AgentId.or(z.literal(""))).default({}),
  models: z.record(AgentId, z.string().max(100)).default({}),
});

export const GET = handle(async () => ok(getAgentPrefs()));

export const PUT = handle(async (req: Request) => {
  const p = await body(req, PrefsSchema);
  return ok(setAgentPrefs({ defaultAgent: p.defaultAgent, departments: p.departments, models: p.models }));
});

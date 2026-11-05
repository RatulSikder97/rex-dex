import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveAgent, terminalCommand } from "@/lib/ai/agents";
import { agentCwd, reusableSession, saveThreadSession, sessionFile, supportsSessions } from "@/lib/ai/sessions";
import { body, fail, handle, ok } from "@/lib/http";
import { agentMcpServers } from "@/lib/connections";
import { resolveDepartment } from "@/lib/plugins/registry";
import { getProject } from "@/lib/repo";

export const dynamic = "force-dynamic";

const Schema = z.object({
  department: z.string().max(40).default("ceo"),
  agent: z.string().regex(/^[a-z0-9-]{2,40}$/).nullish(),
  model: z.string().max(100).nullish(),
  projectId: z.string().nullish(),
  /** Continue an existing Agent-panel conversation; omitted = new conversation. */
  threadId: z.string().max(80).nullish(),
});

/**
 * POST /api/agents/launch → the shell command (and folder) that starts a
 * department's terminal agent interactively, bound to an Agent-panel
 * conversation so the session shows up in REX's chat. Used by the `rex chat` CLI.
 */
export const POST = handle(async (req: Request) => {
  const input = await body(req, Schema);
  const dept = resolveDepartment(input.department);
  const agentId = await resolveAgent(dept, input.agent);
  const project = input.projectId ? getProject(input.projectId) : undefined;
  const cwd = agentCwd(project?.repo_path);
  const threadId = input.threadId || randomUUID();
  let session: { id: string | null; resume: boolean } | undefined;
  if (supportsSessions(agentId)) {
    const existing = reusableSession(threadId, agentId, cwd);
    session = { id: existing ?? (agentId === "claude-cli" ? randomUUID() : null), resume: !!existing && !!sessionFile(agentId, existing) };
  }
  const command = terminalCommand(agentId, "interactive", { model: input.model ?? undefined, system: dept.system, session, mcp: { key: dept.id, servers: await agentMcpServers(dept.id) } });
  if (!command) return fail(`${agentId} has no interactive terminal mode`, 400);
  if (session) saveThreadSession({ thread_id: threadId, agent: agentId, session_id: session.id, cwd, terminal_id: null, department: dept.id, project_id: project?.id ?? null });
  return ok({ command, cwd, threadId, agent: agentId, department: dept.id, departmentName: dept.name });
});

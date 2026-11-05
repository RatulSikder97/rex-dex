import { z } from "zod";
import { body, fail, handle, ok } from "@/lib/http";
import { randomUUID } from "node:crypto";
import { terminalCommand } from "@/lib/ai/agents";
import { agentCwd, reusableSession, saveThreadSession, sessionFile, supportsSessions } from "@/lib/ai/sessions";
import { agentMcpServers, connectionServer, getConnection } from "@/lib/connections";
import { getServer, sshCommandLine } from "@/lib/ops/servers";
import { getProject } from "@/lib/repo";
import { resolveDepartment } from "@/lib/plugins/registry";
import { createTerminal, listTerminals } from "@/lib/terminal";

export const dynamic = "force-dynamic";

export const GET = handle(async () => ok(listTerminals()));

const CreateSchema = z.object({
  projectId: z.string().nullish(),
  cols: z.number().int().min(2).max(1000).default(80),
  rows: z.number().int().min(1).max(500).default(24),
  /** Launch a terminal AI agent: install it, sign in, or open its interactive TUI (optionally as a department). */
  agent: z
    .object({
      id: z.string().regex(/^[a-z0-9-]{2,40}$/),
      action: z.enum(["install", "login", "interactive"]),
      department: z.string().max(40).optional(),
      model: z.string().max(100).optional(),
      /** Interactive only: the Agent-panel conversation to share a session with. */
      threadId: z.string().max(80).optional(),
    })
    .optional(),
  /** Sign in to a third-party connection (CLI login, or the agent's OAuth for remote MCP servers). */
  connection: z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) }).optional(),
  /** Interactive SSH session to an Ops server (your keys / ~/.ssh/config). */
  ssh: z.object({ serverId: z.string().max(80) }).optional(),
});

export const POST = handle(async (req: Request) => {
  const { agent, connection, ssh, ...input } = await body(req, CreateSchema);
  if (ssh) {
    const s = getServer(ssh.serverId);
    if (!s) return fail("Server not found", 404);
    return ok(await createTerminal({ ...input, run: sshCommandLine(s), title: `SSH · ${s.name}` }));
  }
  if (connection) {
    const c = await getConnection(connection.id);
    if (!c) return fail("Unknown connection", 404);
    if (c.auth === "terminal" && c.authCommand) return ok(await createTerminal({ ...input, run: c.authCommand, title: `Connect · ${c.name}` }));
    if (c.auth === "agent-oauth" || c.auth === "oauth") {
      const srv = connectionServer(c);
      if (!srv) return fail("Install and enable this connection first", 400);
      // Claude Code's /mcp opens the provider's sign-in page; the token is reused by later runs.
      const line = terminalCommand("claude-cli", "interactive", { mcp: { key: `connect-${c.id}`, servers: [srv] }, initialPrompt: "/mcp" });
      return ok(await createTerminal({ ...input, run: line ?? "claude", title: `Connect · ${c.name}` }));
    }
    return fail(`${c.name} doesn't sign in from the terminal`, 400);
  }
  if (!agent) return ok(await createTerminal(input));
  const dept = agent.department ? resolveDepartment(agent.department) : null;
  let session: { id: string | null; resume: boolean } | undefined;
  const cwd = agentCwd(input.projectId ? getProject(input.projectId)?.repo_path : null);
  if (agent.action === "interactive" && agent.threadId && supportsSessions(agent.id)) {
    const existing = reusableSession(agent.threadId, agent.id, cwd);
    session = { id: existing ?? (agent.id === "claude-cli" ? randomUUID() : null), resume: !!existing && !!sessionFile(agent.id, existing) };
  }
  const mcp = agent.action === "interactive" ? { key: dept?.id ?? "all", servers: await agentMcpServers(dept?.id) } : undefined;
  const line = terminalCommand(agent.id, agent.action, { model: agent.model, system: dept?.system, session, mcp });
  if (!line) return fail(`This agent has no ${agent.action} command`, 400);
  const verb = { install: "Install", login: "Sign in", interactive: dept?.name ?? "Agent" }[agent.action];
  const term = await createTerminal({ ...input, run: line, title: `${verb} · ${agent.id}` });
  if (session && agent.threadId) saveThreadSession({ thread_id: agent.threadId, agent: agent.id, session_id: session.id, cwd, terminal_id: term.id });
  return ok(term);
});

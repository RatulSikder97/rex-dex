import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { Deliverable, DeliverableKind, Project, Run, RunStatus, Task } from "./types";

const now = () => Date.now();

// ---------- projects ----------
export function listProjects(): Project[] {
  return db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Project[];
}

export function getProject(id: string): Project | undefined {
  return db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

export function createProject(input: Pick<Project, "name"> & Partial<Project>): Project {
  const p: Project = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? "",
    stage: input.stage ?? "idea",
    repo_path: input.repo_path ?? "",
    website_url: input.website_url ?? "",
    logo: "",
    created_at: now(),
    updated_at: now(),
  };
  db()
    .prepare(
      "INSERT INTO projects (id,name,description,stage,repo_path,website_url,created_at,updated_at) VALUES (@id,@name,@description,@stage,@repo_path,@website_url,@created_at,@updated_at)",
    )
    .run(p);
  return p;
}

const PROJECT_FIELDS = ["name", "description", "stage", "repo_path", "website_url", "logo"] as const;

export function updateProject(id: string, patch: Partial<Project>): Project | undefined {
  const sets: string[] = [];
  const vals: Record<string, unknown> = { id, updated_at: now() };
  for (const f of PROJECT_FIELDS) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = @${f}`);
      vals[f] = patch[f];
    }
  }
  if (sets.length) db().prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`).run(vals);
  return getProject(id);
}

export function deleteProject(id: string) {
  db().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// ---------- tasks ----------
export function listTasks(projectId?: string): Task[] {
  if (projectId) {
    return db().prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY position, created_at").all(projectId) as Task[];
  }
  return db().prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as Task[];
}

export function getTask(id: string): Task | undefined {
  return db().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
}

export function createTasks(projectId: string, items: Array<Pick<Task, "title"> & Partial<Task>>): Task[] {
  const conn = db();
  const maxPos = (conn.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE project_id = ?").get(projectId) as { m: number }).m;
  const insert = conn.prepare(
    "INSERT INTO tasks (id,project_id,title,detail,department,status,priority,position,created_at,updated_at) VALUES (@id,@project_id,@title,@detail,@department,@status,@priority,@position,@created_at,@updated_at)",
  );
  const created: Task[] = [];
  conn.transaction(() => {
    items.forEach((item, i) => {
      const t: Task = {
        id: randomUUID(),
        project_id: projectId,
        title: item.title,
        detail: item.detail ?? "",
        department: item.department ?? "engineering",
        status: item.status ?? "backlog",
        priority: item.priority ?? "medium",
        position: maxPos + i + 1,
        created_at: now(),
        updated_at: now(),
      };
      insert.run(t);
      created.push(t);
    });
  })();
  return created;
}

const TASK_FIELDS = ["title", "detail", "department", "status", "priority", "position"] as const;

export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const sets: string[] = [];
  const vals: Record<string, unknown> = { id, updated_at: now() };
  for (const f of TASK_FIELDS) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = @${f}`);
      vals[f] = patch[f];
    }
  }
  if (sets.length) db().prepare(`UPDATE tasks SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`).run(vals);
  return getTask(id);
}

export function deleteTask(id: string) {
  db().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

// ---------- runs ----------
export function createRun(input: Omit<Run, "id" | "output" | "status" | "error" | "created_at" | "finished_at">): Run {
  const r: Run = { ...input, id: randomUUID(), output: "", status: "running", error: null, created_at: now(), finished_at: null };
  db()
    .prepare(
      "INSERT INTO runs (id,project_id,task_id,thread_id,department,provider,brief,output,status,error,created_at,finished_at) VALUES (@id,@project_id,@task_id,@thread_id,@department,@provider,@brief,@output,@status,@error,@created_at,@finished_at)",
    )
    .run(r);
  return r;
}

export function finishRun(id: string, output: string, status: RunStatus, error: string | null) {
  db().prepare("UPDATE runs SET output = ?, status = ?, error = ?, finished_at = ? WHERE id = ?").run(output, status, error, now(), id);
}

/** The run moved to another agent (automatic fallback after a sign-in failure). */
export function setRunProvider(id: string, provider: string) {
  db().prepare("UPDATE runs SET provider = ? WHERE id = ?").run(provider, id);
}

export function saveRunOutput(id: string, output: string) {
  db().prepare("UPDATE runs SET output = ? WHERE id = ?").run(output, id);
}

export function getRun(id: string): Run | undefined {
  return db().prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
}

export function listRuns(opts: { projectId?: string; threadId?: string; limit?: number } = {}): Run[] {
  const limit = Math.min(opts.limit ?? 50, 500);
  if (opts.threadId) {
    return db().prepare("SELECT * FROM runs WHERE thread_id = ? ORDER BY created_at ASC").all(opts.threadId) as Run[];
  }
  if (opts.projectId) {
    return db().prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(opts.projectId, limit) as Run[];
  }
  return db().prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit) as Run[];
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  turns: number;
  updated_at: number;
  running: number;
}

/** Conversation threads for one department (optionally within a project), newest first. */
export function listThreads(department: string, projectId: string | null): ThreadSummary[] {
  const where = projectId ? "department = ? AND project_id = ?" : "department = ? AND project_id IS NULL";
  const args = projectId ? [department, projectId] : [department];
  return db()
    .prepare(
      `SELECT thread_id,
              (SELECT brief FROM runs r2 WHERE r2.thread_id = runs.thread_id ORDER BY created_at ASC LIMIT 1) AS title,
              COUNT(*) AS turns, MAX(created_at) AS updated_at, SUM(status = 'running') AS running
       FROM runs WHERE thread_id IS NOT NULL AND thread_id NOT LIKE 'swarm:%' AND ${where}
       GROUP BY thread_id
       UNION ALL
       -- conversations that only exist as an agent session (started via \`rex chat\` / the terminal)
       SELECT thread_id, COALESCE(title, 'Terminal session') AS title, 0 AS turns, updated_at, 0 AS running
       FROM agent_threads a
       WHERE ${where.replace("project_id", "a.project_id").replace("department", "a.department")}
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = a.thread_id)
       ORDER BY updated_at DESC LIMIT 50`,
    )
    .all(...args, ...args) as ThreadSummary[];
}

/** Conversation threads across every department (optionally within a project), newest first. */
export function listAllThreads(projectId: string | null, limit = 60): (ThreadSummary & { department: string })[] {
  const where = projectId ? "project_id = ?" : "project_id IS NULL";
  const args: unknown[] = projectId ? [projectId] : [];
  return db()
    .prepare(
      `SELECT thread_id,
              (SELECT department FROM runs r2 WHERE r2.thread_id = runs.thread_id ORDER BY created_at ASC LIMIT 1) AS department,
              (SELECT brief FROM runs r2 WHERE r2.thread_id = runs.thread_id ORDER BY created_at ASC LIMIT 1) AS title,
              COUNT(*) AS turns, MAX(created_at) AS updated_at, SUM(status = 'running') AS running
       FROM runs WHERE thread_id IS NOT NULL AND thread_id NOT LIKE 'swarm:%' AND ${where}
       GROUP BY thread_id ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(limit, 1), 200)) as (ThreadSummary & { department: string })[];
}

/** Deletes every run in a conversation thread. */
export function deleteThread(threadId: string) {
  db().prepare("DELETE FROM runs WHERE thread_id = ? AND status != 'running'").run(threadId);
}

/** Runs left "running" by a previous server process can never finish. */
export function markOrphanedRuns() {
  db().prepare("UPDATE runs SET status = 'error', error = 'Server restarted during run', finished_at = ? WHERE status = 'running'").run(now());
}

// ---------- deliverables ----------
export function listDeliverables(projectId?: string): Deliverable[] {
  const cols = "id, project_id, run_id, department, kind, title, '' AS content, created_at, updated_at";
  if (projectId) {
    return db().prepare(`SELECT ${cols} FROM deliverables WHERE project_id = ? ORDER BY updated_at DESC`).all(projectId) as Deliverable[];
  }
  return db().prepare(`SELECT ${cols} FROM deliverables ORDER BY updated_at DESC LIMIT 200`).all() as Deliverable[];
}

export function getDeliverable(id: string): Deliverable | undefined {
  return db().prepare("SELECT * FROM deliverables WHERE id = ?").get(id) as Deliverable | undefined;
}

export function createDeliverable(input: {
  project_id: string | null;
  run_id?: string | null;
  department: string;
  kind: DeliverableKind;
  title: string;
  content: string;
}): Deliverable {
  const d: Deliverable = { ...input, run_id: input.run_id ?? null, id: randomUUID(), created_at: now(), updated_at: now() };
  db()
    .prepare(
      "INSERT INTO deliverables (id,project_id,run_id,department,kind,title,content,created_at,updated_at) VALUES (@id,@project_id,@run_id,@department,@kind,@title,@content,@created_at,@updated_at)",
    )
    .run(d);
  return d;
}

export function updateDeliverable(id: string, patch: { title?: string; content?: string }): Deliverable | undefined {
  const cur = getDeliverable(id);
  if (!cur) return undefined;
  db()
    .prepare("UPDATE deliverables SET title = ?, content = ?, updated_at = ? WHERE id = ?")
    .run(patch.title ?? cur.title, patch.content ?? cur.content, now(), id);
  return getDeliverable(id);
}

export function deleteDeliverable(id: string) {
  db().prepare("DELETE FROM deliverables WHERE id = ?").run(id);
}

// ---------- settings ----------
export function getSetting(key: string): string | undefined {
  return (db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- dashboard ----------
export function dashboardStats() {
  const conn = db();
  const byStage = conn.prepare("SELECT stage, COUNT(*) AS n FROM projects GROUP BY stage").all() as { stage: string; n: number }[];
  const openByDept = conn
    .prepare("SELECT department, COUNT(*) AS n FROM tasks WHERE status != 'done' GROUP BY department")
    .all() as { department: string; n: number }[];
  const taskTotals = conn
    .prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status")
    .all() as { status: string; n: number }[];
  const runs7d = conn
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE created_at > ?")
    .get(now() - 7 * 86400_000) as { n: number };
  const deliverables = conn.prepare("SELECT COUNT(*) AS n FROM deliverables").get() as { n: number };
  return { byStage, openByDept, taskTotals, runs7d: runs7d.n, deliverables: deliverables.n };
}

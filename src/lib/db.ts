import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.REX_DATA_DIR || path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");

/**
 * Ordered, append-only migrations. Never edit a shipped entry — add a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'idea',
    repo_path TEXT NOT NULL DEFAULT '',
    website_url TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT 'engineering',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'medium',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX tasks_project ON tasks(project_id, status, position);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    thread_id TEXT,
    department TEXT NOT NULL,
    provider TEXT NOT NULL,
    brief TEXT NOT NULL,
    output TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX runs_thread ON runs(thread_id, created_at);
  CREATE INDEX runs_project ON runs(project_id, created_at);
  CREATE TABLE deliverables (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    department TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'markdown',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX deliverables_project ON deliverables(project_id, created_at);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE media_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    options TEXT NOT NULL DEFAULT '{}',
    plan TEXT NOT NULL DEFAULT '{}',
    progress INTEGER NOT NULL DEFAULT 0,
    step TEXT NOT NULL DEFAULT '',
    logs TEXT NOT NULL DEFAULT '',
    output TEXT,
    srt TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX media_jobs_created ON media_jobs(created_at);
  `,
  `
  -- Links an Agent-panel conversation to the terminal agent's own session
  -- (Claude Code / Codex session id), so the panel and the integrated terminal
  -- share one conversation.
  CREATE TABLE agent_threads (
    thread_id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    session_id TEXT,
    cwd TEXT NOT NULL,
    terminal_id TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  -- Conversations started outside the Agent panel (\`rex chat\`, terminal) still list in its history.
  ALTER TABLE agent_threads ADD COLUMN department TEXT;
  ALTER TABLE agent_threads ADD COLUMN project_id TEXT;
  ALTER TABLE agent_threads ADD COLUMN title TEXT;
  `,
  `
  -- Ops Center: SSH servers (+ last health/traffic snapshot) and uptime monitors.
  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    user TEXT,
    port INTEGER NOT NULL DEFAULT 22,
    identity_file TEXT,
    log_path TEXT,
    last_snapshot TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE monitors (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE monitor_checks (
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    status INTEGER,
    ms INTEGER,
    error TEXT,
    tls_days_left INTEGER
  );
  CREATE INDEX monitor_checks_by_monitor ON monitor_checks(monitor_id, at);
  `,
  `
  -- Agent swarms: a goal/task split into department steps (a DAG) run by several agents.
  CREATE TABLE swarms (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    max_parallel INTEGER NOT NULL DEFAULT 3,
    allow_edits INTEGER NOT NULL DEFAULT 0,
    synthesis TEXT,
    deliverable_id TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE TABLE swarm_steps (
    id TEXT PRIMARY KEY,
    swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    agent TEXT,
    brief TEXT NOT NULL,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    run_id TEXT,
    error TEXT,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX swarm_steps_by_swarm ON swarm_steps(swarm_id, idx);
  `,
  `
  -- Project logo (sanitized SVG markup), generated by the Design agent or uploaded.
  ALTER TABLE projects ADD COLUMN logo TEXT NOT NULL DEFAULT '';
  `,
];

function migrate(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const row = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(i + 1, Date.now());
    })();
  }
}

const globalForDb = globalThis as unknown as { __rexDb?: Database.Database; __rexDbVersion?: number };

export function db(): Database.Database {
  if (!globalForDb.__rexDb) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const conn = new Database(path.join(DATA_DIR, "rex.db"), { timeout: 5000 });
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    migrate(conn);
    globalForDb.__rexDb = conn;
    globalForDb.__rexDbVersion = MIGRATIONS.length;
  } else if (globalForDb.__rexDbVersion !== MIGRATIONS.length) {
    // The connection survives dev hot reloads; apply migrations added since it opened.
    migrate(globalForDb.__rexDb);
    globalForDb.__rexDbVersion = MIGRATIONS.length;
  }
  return globalForDb.__rexDb;
}

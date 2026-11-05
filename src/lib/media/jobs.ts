import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { db } from "../db";
import type { AnyPlan, JobKind, JobOptions, JobStatus, MediaJob } from "./plan";

/** Data access for `media_jobs`. All DB work is lazy (never at module top level). */

const MAX_LOG_CHARS = 100_000;

const g = globalThis as unknown as { __rexMediaJobsChecked?: boolean; __rexDb?: Database.Database };

function conn(): Database.Database {
  const d = db();
  if (!g.__rexMediaJobsChecked) {
    g.__rexMediaJobsChecked = true;
    const exists = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_jobs'").get();
    if (!exists) {
      // The connection is cached on globalThis across dev hot reloads, so a migration
      // appended after it was opened never ran. Reopen once so db() applies it.
      d.close();
      g.__rexDb = undefined;
      return db();
    }
  }
  return d;
}

interface Row {
  id: string;
  project_id: string | null;
  kind: JobKind;
  title: string;
  status: JobStatus;
  options: string;
  plan: string;
  progress: number;
  step: string;
  logs: string;
  output: string | null;
  srt: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function hydrate(r: Row): MediaJob {
  return { ...r, options: JSON.parse(r.options) as JobOptions, plan: JSON.parse(r.plan) as AnyPlan };
}

export function createJob(input: { projectId: string | null; kind: JobKind; title: string; options: JobOptions; plan: AnyPlan }): MediaJob {
  const now = Date.now();
  const id = randomUUID();
  conn()
    .prepare(
      `INSERT INTO media_jobs (id, project_id, kind, title, status, options, plan, progress, step, logs, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, 'Queued', '', ?, ?)`,
    )
    .run(id, input.projectId, input.kind, input.title, JSON.stringify(input.options), JSON.stringify(input.plan), now, now);
  return getJob(id)!;
}

export function getJob(id: string): MediaJob | undefined {
  const r = conn().prepare("SELECT * FROM media_jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? hydrate(r) : undefined;
}

/** Recent jobs without logs (list view). */
export function listJobs(limit = 50): Omit<MediaJob, "logs">[] {
  const rows = conn()
    .prepare(
      `SELECT id, project_id, kind, title, status, options, plan, progress, step, output, srt, error, created_at, updated_at
       FROM media_jobs ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as Omit<Row, "logs">[];
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) as JobOptions, plan: JSON.parse(r.plan) as AnyPlan }));
}

export function updateJob(id: string, patch: Partial<Pick<MediaJob, "status" | "progress" | "step" | "output" | "srt" | "error">>) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(", ");
  conn()
    .prepare(`UPDATE media_jobs SET ${sets}, updated_at = @updated_at WHERE id = @id`)
    .run({ ...Object.fromEntries(entries), id, updated_at: Date.now() });
}

export function appendJobLog(id: string, line: string) {
  const stamp = new Date().toTimeString().slice(0, 8);
  conn()
    .prepare("UPDATE media_jobs SET logs = substr(logs || ?, ?), updated_at = ? WHERE id = ?")
    .run(`[${stamp}] ${line}\n`, -MAX_LOG_CHARS, Date.now(), id);
}

export function deleteJob(id: string): boolean {
  return conn().prepare("DELETE FROM media_jobs WHERE id = ?").run(id).changes > 0;
}

/** Jobs left queued/running by a previous server process can never finish. */
export function markOrphanedJobs(liveIds: string[]) {
  const rows = conn().prepare("SELECT id FROM media_jobs WHERE status IN ('queued', 'running')").all() as { id: string }[];
  for (const { id } of rows) {
    if (liveIds.includes(id)) continue;
    updateJob(id, { status: "error", error: "Interrupted by a server restart", step: "Interrupted" });
  }
}

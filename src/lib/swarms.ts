import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { getAgentSpec } from "./ai/agents";
import { allDepartments } from "./plugins/registry";
import * as repo from "./repo";
import { extractJson, runToText, startRun, subscribeRun, cancelRun } from "./runs";
import type { Run } from "./types";

/**
 * Agent swarms. A goal (or a board task) is planned by the Chief of Staff into
 * department steps with dependencies (a DAG). Independent steps run in
 * parallel, each on its own terminal agent; every step receives the outputs of
 * the steps it depends on; a synthesis step merges the results into one
 * deliverable. Steps can be re-assigned to another agent, retried or skipped.
 */

export type SwarmStatus = "planning" | "planned" | "running" | "done" | "error" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped" | "cancelled";

export interface SwarmStep {
  id: string;
  swarm_id: string;
  key: string;
  idx: number;
  title: string;
  department: string;
  agent: string | null;
  brief: string;
  depends_on: string[];
  status: StepStatus;
  run_id: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface Swarm {
  id: string;
  project_id: string | null;
  task_id: string | null;
  goal: string;
  status: SwarmStatus;
  max_parallel: number;
  allow_edits: boolean;
  synthesis: string | null;
  deliverable_id: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
  steps: (SwarmStep & { output?: string; provider?: string | null })[];
}

type SwarmRow = Omit<Swarm, "steps" | "allow_edits"> & { allow_edits: number };
type StepRow = Omit<SwarmStep, "depends_on"> & { depends_on: string };

const SYNTH_KEY = "synthesis";

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

function rowToStep(r: StepRow): SwarmStep {
  let deps: string[] = [];
  try {
    deps = JSON.parse(r.depends_on);
  } catch {
    /* none */
  }
  return { ...r, depends_on: deps };
}

export function getSwarm(id: string, withOutput = true): Swarm | undefined {
  const s = db().prepare("SELECT * FROM swarms WHERE id = ?").get(id) as SwarmRow | undefined;
  if (!s) return undefined;
  const steps = (db().prepare("SELECT * FROM swarm_steps WHERE swarm_id = ? ORDER BY idx").all(id) as StepRow[]).map(rowToStep);
  return {
    ...s,
    allow_edits: !!s.allow_edits,
    steps: steps.map((st) => {
      if (!withOutput || !st.run_id) return st;
      const run = repo.getRun(st.run_id);
      return { ...st, output: run?.output ?? "", provider: run?.provider ?? null };
    }),
  };
}

const gb = globalThis as unknown as { __rexSwarmsBooted?: boolean };
/** Once per server process: pick swarms back up after a restart. */
export function bootSwarms() {
  if (gb.__rexSwarmsBooted) return;
  gb.__rexSwarmsBooted = true;
  resumeSwarms();
}

export function deleteSwarm(id: string) {
  const s = getSwarm(id, false);
  if (s?.status === "running" || s?.status === "planning") throw new Error("Cancel the swarm first");
  db().prepare("DELETE FROM swarms WHERE id = ?").run(id);
}

export function listSwarms(projectId?: string | null): Swarm[] {
  bootSwarms();
  const rows = (projectId
    ? db().prepare("SELECT id FROM swarms WHERE project_id = ? ORDER BY created_at DESC LIMIT 50").all(projectId)
    : db().prepare("SELECT id FROM swarms ORDER BY created_at DESC LIMIT 50").all()) as { id: string }[];
  return rows.map((r) => getSwarm(r.id, false)!).filter(Boolean);
}

function setSwarm(id: string, patch: Partial<Pick<Swarm, "status" | "error" | "finished_at" | "deliverable_id" | "synthesis">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db().prepare(`UPDATE swarms SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...patch, id });
}

function setStep(id: string, patch: Partial<Pick<SwarmStep, "status" | "run_id" | "error" | "started_at" | "finished_at" | "agent" | "brief" | "title" | "department">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db().prepare(`UPDATE swarm_steps SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...patch, id });
}

// ---------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------

const PlanSchema = z.object({
  steps: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_-]{1,30}$/i),
        title: z.string().min(1).max(120),
        department: z.string().min(1).max(40),
        brief: z.string().min(1).max(6000),
        dependsOn: z.array(z.string()).max(10).default([]),
      }),
    )
    .min(1)
    .max(12),
  synthesis: z.string().max(3000).default(""),
});

export interface CreateSwarmInput {
  projectId?: string | null;
  taskId?: string | null;
  goal: string;
  maxParallel?: number;
  allowEdits?: boolean;
  /** Start immediately after planning (otherwise wait for approval). */
  autoStart?: boolean;
  /** Restrict / hint departments. */
  departments?: string[];
}

export async function createSwarm(input: CreateSwarmInput): Promise<Swarm> {
  const id = randomUUID();
  const task = input.taskId ? repo.getTask(input.taskId) : undefined;
  const goal = input.goal.trim() || (task ? `${task.title}\n\n${task.detail}` : "");
  db()
    .prepare("INSERT INTO swarms (id, project_id, task_id, goal, status, max_parallel, allow_edits, created_at) VALUES (?, ?, ?, ?, 'planning', ?, ?, ?)")
    .run(id, input.projectId ?? task?.project_id ?? null, input.taskId ?? null, goal, Math.min(6, Math.max(1, input.maxParallel ?? 3)), input.allowEdits ? 1 : 0, Date.now());
  void plan(id, goal, input).catch((e) => setSwarm(id, { status: "error", error: e instanceof Error ? e.message : String(e), finished_at: Date.now() }));
  return getSwarm(id)!;
}

async function plan(id: string, goal: string, input: CreateSwarmInput) {
  const depts = allDepartments().filter((d) => d.id !== "ceo" && (!input.departments?.length || input.departments.includes(d.id)));
  const brief = `Plan an agent swarm for this goal. Split it into 2–8 concrete steps, each owned by ONE department, so several specialists can work in parallel.

Goal:
${goal}

Available departments (use these ids exactly):
${depts.map((d) => `- ${d.id}: ${d.name} — ${d.role}`).join("\n")}

Rules:
- Each step is a self-contained brief for that department's agent (what to produce, constraints, format). Write it as an instruction to that specialist.
- Use dependsOn (step keys) only when a step truly needs another step's output; otherwise leave it empty so steps run in parallel. No cycles.
- Keep steps to work an agent can finish in one run.
- "synthesis": how the Chief of Staff should combine the results into the final deliverable.

Respond with ONLY JSON: {"steps":[{"key":"research","title":"…","department":"marketing","brief":"…","dependsOn":[]}],"synthesis":"…"}`;
  const text = await runToText({ department: "ceo", brief, projectId: input.projectId ?? null, taskId: input.taskId ?? null, threadId: `swarm:${id}:plan` });
  // Cancelled (or deleted) while the Chief of Staff was planning: drop the plan.
  if (getSwarm(id, false)?.status !== "planning") return;
  const parsed = PlanSchema.parse(extractJson(text));
  const valid = new Set(allDepartments().map((d) => d.id));
  const keys = new Set(parsed.steps.map((s) => s.key));
  const insert = db().prepare("INSERT INTO swarm_steps (id, swarm_id, key, idx, title, department, agent, brief, depends_on, status) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending')");
  db().transaction(() => {
    parsed.steps.forEach((s, i) => {
      const deps = s.dependsOn.filter((d) => keys.has(d) && d !== s.key);
      insert.run(randomUUID(), id, s.key, i, s.title, valid.has(s.department) ? s.department : "ceo", s.brief, JSON.stringify(deps));
    });
    insert.run(randomUUID(), id, SYNTH_KEY, parsed.steps.length, "Synthesize the final deliverable", "ceo", parsed.synthesis || "Combine the step results into one clear, final deliverable for the CEO.", JSON.stringify(parsed.steps.map((s) => s.key)));
  })();
  if (hasCycle(getSwarm(id, false)!.steps)) throw new Error("The plan has circular dependencies — try again");
  if (getSwarm(id, false)?.status !== "planning") return;
  setSwarm(id, { status: "planned", synthesis: parsed.synthesis });
  if (input.autoStart) startSwarm(id);
}

function hasCycle(steps: SwarmStep[]): boolean {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of byKey.get(k)?.depends_on ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  return steps.some((s) => visit(s.key));
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rexSwarmWatch?: Set<string> };
const watching: Set<string> = (g.__rexSwarmWatch ??= new Set());

export function startSwarm(id: string) {
  const s = getSwarm(id, false);
  if (!s) throw new Error("Swarm not found");
  if (s.status === "planning") throw new Error("Still planning");
  setSwarm(id, { status: "running", error: null, finished_at: null });
  if (s.task_id) repo.updateTask(s.task_id, { status: "doing" });
  void tick(id);
}

const outputOf = (st: SwarmStep) => (st.run_id ? (repo.getRun(st.run_id)?.output ?? "") : "");

const gl = globalThis as unknown as { __rexSwarmLocks?: Map<string, Promise<void>> };
const locks: Map<string, Promise<void>> = (gl.__rexSwarmLocks ??= new Map());

/** Ticks for one swarm run strictly one after another, so a step can't be started twice. */
function tick(id: string): Promise<void> {
  const next = (locks.get(id) ?? Promise.resolve()).then(() => tickNow(id)).catch(() => {});
  locks.set(id, next);
  void next.finally(() => locks.get(id) === next && locks.delete(id));
  return next;
}

/** Starts every ready step (dependencies done/skipped) up to max_parallel; finishes the swarm when nothing is left. */
async function tickNow(id: string): Promise<void> {
  const s = getSwarm(id, false);
  if (!s || s.status !== "running") return;
  const byKey = new Map(s.steps.map((st) => [st.key, st]));
  const settled = (st?: SwarmStep) => !!st && (st.status === "done" || st.status === "skipped");
  const running = s.steps.filter((st) => st.status === "running").length;

  if (s.steps.every((st) => settled(st))) return finish(id);
  if (!running && s.steps.every((st) => settled(st) || st.status === "cancelled")) {
    setSwarm(id, { status: "cancelled", finished_at: Date.now() });
    return;
  }
  const blocked = s.steps.some((st) => st.status === "error");
  if (blocked && !running) {
    setSwarm(id, { status: "error", error: "A step failed — retry it, re-assign its agent, or skip it", finished_at: Date.now() });
    return;
  }
  if (blocked) return;

  const ready = s.steps.filter((st) => st.status === "pending" && st.depends_on.every((d) => settled(byKey.get(d))));
  for (const st of ready.slice(0, Math.max(0, s.max_parallel - running))) {
    // Re-check: an earlier iteration's await may have let something else change it.
    const fresh = db().prepare("SELECT status FROM swarm_steps WHERE id = ?").get(st.id) as { status: StepStatus } | undefined;
    if (fresh?.status !== "pending") continue;
    const context = st.depends_on
      .map((k) => byKey.get(k)!)
      .filter((d) => d.status === "done")
      .map((d) => `## ${d.title} (${d.department})\n${outputOf(d).slice(0, 14_000)}`)
      .join("\n\n");
    const isSynth = st.key === SYNTH_KEY;
    const brief = `${isSynth ? "You are closing an agent swarm." : "You are one specialist in an agent swarm."}\n\nOverall goal:\n${s.goal}\n\nYour step: ${st.title}\n${st.brief}${isSynth ? "\n\nProduce the final deliverable now, in clean Markdown." : ""}`;
    setStep(st.id, { status: "running", started_at: Date.now(), finished_at: null, error: null });
    let run: Run;
    try {
      run = await startRun({
        department: st.department,
        provider: st.agent,
        brief,
        projectId: s.project_id,
        taskId: s.task_id,
        threadId: `swarm:${s.id}:${st.key}`,
        allowEdits: s.allow_edits && !isSynth,
        context: context ? `Results from the steps this one depends on:\n\n${context}` : undefined,
      });
    } catch (e) {
      setStep(st.id, { status: "error", error: e instanceof Error ? e.message : String(e), finished_at: Date.now() });
      continue;
    }
    setStep(st.id, { run_id: run.id });
    watch(id, st.id, run.id);
  }
}

function watch(swarmId: string, stepId: string, runId: string) {
  if (watching.has(runId)) return;
  watching.add(runId);
  const unsub = subscribeRun(runId, (ev) => {
    const status = ev.type === "chunk" ? "running" : ev.status;
    if (status === "running") return;
    watching.delete(runId);
    setTimeout(() => unsub(), 0);
    const cur = db().prepare("SELECT status FROM swarm_steps WHERE id = ?").get(stepId) as { status: StepStatus } | undefined;
    if (cur?.status !== "running") return; // skipped / cancelled meanwhile
    setStep(stepId, {
      status: status === "done" ? "done" : status === "cancelled" ? "cancelled" : "error",
      error: status === "done" ? null : ((ev.type !== "chunk" && ev.error) || status),
      finished_at: Date.now(),
    });
    void tick(swarmId);
  });
}

function finish(id: string) {
  const s = getSwarm(id, false)!;
  const synth = s.steps.find((st) => st.key === SYNTH_KEY);
  // The deliverable is the synthesis text without the agent's tool-call trace lines.
  const output = (synth ? outputOf(synth) : "")
    .split("\n")
    .filter((l) => !/^> (🔧|✏️|⚠️)/.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let deliverableId: string | null = null;
  if (output.trim()) {
    const d = repo.createDeliverable({ project_id: s.project_id, run_id: synth?.run_id ?? null, department: "ceo", kind: "markdown", title: `Swarm: ${s.goal.replace(/\s+/g, " ").slice(0, 70)}`, content: output });
    deliverableId = d.id;
  }
  if (s.task_id) repo.updateTask(s.task_id, { status: "review" });
  setSwarm(id, { status: "done", finished_at: Date.now(), deliverable_id: deliverableId });
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

export function cancelSwarm(id: string) {
  const s = getSwarm(id, false);
  if (!s) throw new Error("Swarm not found");
  for (const st of s.steps) {
    if (st.status === "running" && st.run_id) cancelRun(st.run_id);
    if (st.status === "running" || st.status === "pending") setStep(st.id, { status: "cancelled", finished_at: Date.now() });
  }
  setSwarm(id, { status: "cancelled", finished_at: Date.now() });
}

export function updateStep(swarmId: string, stepId: string, action: "retry" | "skip" | "set-agent" | "edit", patch: { agent?: string | null; brief?: string; title?: string; department?: string } = {}) {
  const s = getSwarm(swarmId, false);
  const st = s?.steps.find((x) => x.id === stepId);
  if (!s || !st) throw new Error("Step not found");
  if (action === "set-agent") {
    if (patch.agent && !getAgentSpec(patch.agent)) throw new Error(`Unknown agent "${patch.agent}"`);
    setStep(stepId, { agent: patch.agent || null });
  }
  else if (action === "edit") {
    if (st.status === "running") throw new Error("Can't edit a running step");
    if (patch.department && !allDepartments().some((d) => d.id === patch.department)) throw new Error(`Unknown department "${patch.department}"`);
    if (patch.brief !== undefined && !patch.brief.trim()) throw new Error("The brief can't be empty");
    if (patch.title !== undefined && !patch.title.trim()) throw new Error("The title can't be empty");
    setStep(stepId, { ...(patch.brief ? { brief: patch.brief.trim() } : {}), ...(patch.title ? { title: patch.title.trim() } : {}), ...(patch.department ? { department: patch.department } : {}) });
  } else if (action === "skip") {
    if (st.status === "running" && st.run_id) cancelRun(st.run_id);
    setStep(stepId, { status: "skipped", finished_at: Date.now() });
  } else if (action === "retry") {
    if (st.status === "running") throw new Error("Step is running");
    setStep(stepId, { status: "pending", error: null, run_id: null, started_at: null, finished_at: null });
  }
  if ((action === "retry" || action === "skip") && s.status === "cancelled") {
    // Resuming a cancelled swarm: everything that was cancelled goes back in the queue (incl. synthesis).
    db().prepare("UPDATE swarm_steps SET status = 'pending', error = NULL, run_id = NULL, started_at = NULL, finished_at = NULL WHERE swarm_id = ? AND status = 'cancelled'").run(swarmId);
  }
  if (action === "retry" || action === "skip") {
    if (s.status !== "running" && s.status !== "planning" && s.status !== "planned") setSwarm(swarmId, { status: "running", error: null, finished_at: null });
    if (s.status === "running" || s.status === "error" || s.status === "done" || s.status === "cancelled") void tick(swarmId);
  }
  return getSwarm(swarmId);
}

/** Swarms left running by a previous server process: re-attach to their live runs or mark steps failed. */
export function resumeSwarms() {
  const rows = db().prepare("SELECT id FROM swarms WHERE status = 'running'").all() as { id: string }[];
  for (const { id } of rows) {
    const s = getSwarm(id, false)!;
    for (const st of s.steps) {
      if (st.status !== "running") continue;
      const run = st.run_id ? repo.getRun(st.run_id) : undefined;
      if (run?.status === "running") watch(id, st.id, run.id);
      else setStep(st.id, { status: run?.status === "done" ? "done" : "error", error: run?.status === "done" ? null : (run?.error ?? "Interrupted"), finished_at: Date.now() });
    }
    void tick(id);
  }
}

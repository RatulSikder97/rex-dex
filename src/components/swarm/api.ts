"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Swarm, SwarmStatus, SwarmStep, StepStatus } from "@/lib/swarms";
import { useWorkbench } from "@/store/workbench";

export type { Swarm, SwarmStatus, StepStatus };
/** A step as returned by GET /api/swarms/:id (live output + the agent actually used). */
export type Step = SwarmStep & { output?: string; provider?: string | null };

export const SYNTH_KEY = "synthesis";
export const isActive = (s: Pick<Swarm, "status">) => s.status === "planning" || s.status === "running";
export const isFinished = (s: Pick<Swarm, "status">) => s.status === "done" || s.status === "error" || s.status === "cancelled";

/** "Swarm · first line of the goal" for tab titles. */
export function swarmTitle(goal: string, max = 40): string {
  const line = goal.split("\n").find((l) => l.trim())?.trim() ?? "Swarm";
  return `Swarm · ${line.length > max ? `${line.slice(0, max - 1)}…` : line}`;
}

export function openSwarm(s: Pick<Swarm, "id" | "goal">) {
  useWorkbench.getState().openTab({ kind: "swarm", id: s.id }, swarmTitle(s.goal));
}

export function openSwarmList(compose = false) {
  useWorkbench.getState().openTab(compose ? { kind: "swarms", compose: Date.now() } : { kind: "swarms" }, "Swarms");
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CreateSwarmInput {
  projectId?: string | null;
  taskId?: string | null;
  goal: string;
  maxParallel?: number;
  allowEdits?: boolean;
  autoStart?: boolean;
  departments?: string[];
}

/** Creates a swarm (the Chief of Staff plans it in the background) and opens its tab. */
export async function createSwarm(input: CreateSwarmInput): Promise<Swarm | null> {
  const st = useWorkbench.getState();
  try {
    const s = await api<Swarm>("/api/swarms", { method: "POST", json: input });
    st.log("ok", "swarm", "Swarm created — the Chief of Staff is planning it");
    st.bump();
    openSwarm(s);
    return s;
  } catch (e) {
    st.log("error", "swarm", err(e));
    return null;
  }
}

/** Swarm from a board task: goal = title + detail, review before running. */
export function swarmTask(t: { id: string; project_id: string; title: string; detail?: string }) {
  return createSwarm({ projectId: t.project_id, taskId: t.id, goal: t.detail ? `${t.title}\n\n${t.detail}` : t.title, autoStart: false });
}

export async function swarmAction(id: string, action: "start" | "cancel"): Promise<Swarm | null> {
  try {
    const s = await api<Swarm>(`/api/swarms/${id}`, { method: "POST", json: { action } });
    useWorkbench.getState().bump();
    return s;
  } catch (e) {
    useWorkbench.getState().log("error", "swarm", err(e));
    return null;
  }
}

export async function deleteSwarm(id: string): Promise<boolean> {
  try {
    await api(`/api/swarms/${id}`, { method: "DELETE" });
    useWorkbench.getState().bump();
    return true;
  } catch (e) {
    useWorkbench.getState().log("error", "swarm", err(e));
    return false;
  }
}

export async function stepAction(
  swarmId: string,
  stepId: string,
  action: "retry" | "skip" | "set-agent" | "edit",
  patch: { agent?: string; brief?: string; title?: string; department?: string } = {},
): Promise<Swarm | null> {
  try {
    const s = await api<Swarm>(`/api/swarms/${swarmId}/steps/${stepId}`, { method: "POST", json: { action, ...patch } });
    if (action === "retry" || action === "skip") useWorkbench.getState().bump();
    return s;
  } catch (e) {
    useWorkbench.getState().log("error", "swarm", err(e));
    return null;
  }
}

/** One swarm, polled every 2s while planning/running (stops once finished or planned). */
export function useSwarm(id: string) {
  const [swarm, setSwarm] = useState<Swarm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const last = useRef("");
  const apply = useCallback((s: Swarm) => {
    const j = JSON.stringify(s);
    if (j === last.current) return;
    last.current = j;
    setSwarm(s);
  }, []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Restart polling whenever the swarm becomes active again (Start, Retry on a failed swarm…).
  const live = swarm ? isActive(swarm) : true;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const s = await api<Swarm>(`/api/swarms/${id}`);
        if (stop) return;
        apply(s);
        setError(null);
        if (isActive(s)) timer = setTimeout(load, 2000);
      } catch (e) {
        if (stop) return;
        setError(err(e));
        timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, tick, apply, live]);

  return { swarm, error, reload, apply };
}

/** Swarms for a project; polls every 4s while any is active, otherwise on store `version` bumps. */
export function useSwarms(projectId: string | null | undefined) {
  const version = useWorkbench((s) => s.version);
  const [swarms, setSwarms] = useState<Swarm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef("");

  useEffect(() => {
    if (!projectId) {
      setSwarms([]);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const list = await api<Swarm[]>(`/api/swarms?projectId=${encodeURIComponent(projectId)}`);
        if (stop) return;
        const j = JSON.stringify(list);
        if (j !== last.current) {
          last.current = j;
          setSwarms(list);
        }
        setError(null);
        timer = setTimeout(load, list.some(isActive) ? 4000 : 15000);
      } catch (e) {
        if (stop) return;
        setError(err(e));
        setSwarms((s) => s ?? []);
        timer = setTimeout(load, 15000);
      }
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [projectId, version]);

  return { swarms, error };
}

/** Column (dependency depth) of every step: 0 = no deps; synthesis always last. */
export function stepDepths(steps: Pick<SwarmStep, "key" | "depends_on">[]): Map<string, number> {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (k: string): number => {
    const known = depth.get(k);
    if (known !== undefined) return known;
    if (visiting.has(k)) return 0; // cycle guard (backend rejects cycles)
    visiting.add(k);
    const deps = (byKey.get(k)?.depends_on ?? []).filter((d) => byKey.has(d));
    const d = deps.length ? Math.max(...deps.map(visit)) + 1 : 0;
    visiting.delete(k);
    depth.set(k, d);
    return d;
  };
  for (const s of steps) visit(s.key);
  // Synthesis sits alone in the last column.
  if (byKey.has(SYNTH_KEY)) {
    const others = steps.filter((s) => s.key !== SYNTH_KEY).map((s) => depth.get(s.key) ?? 0);
    depth.set(SYNTH_KEY, (others.length ? Math.max(...others) : -1) + 1);
  }
  return depth;
}

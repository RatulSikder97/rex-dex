"use client";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import type { OpsOverview, OpsProblem } from "@/lib/opsTypes";

/**
 * Ops problems for the Issues feed (monitors down, TLS expiring, unhealthy servers, failing pods).
 * One shared poller per project (every 60 s) no matter how many components read it.
 */
const POLL_MS = 60_000;
const EMPTY: OpsProblem[] = [];
let current: { projectId: string | null; problems: OpsProblem[] } = { projectId: null, problems: EMPTY };
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let polledFor: string | null | undefined;
const listeners = new Set<() => void>();

async function poll(projectId: string | null) {
  try {
    const o = await api<OpsOverview>(`/api/ops/overview${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
    if (polledFor !== projectId) return;
    current = { projectId, problems: o.problems ?? EMPTY };
  } catch {
    if (polledFor !== projectId) return;
    current = { projectId, problems: EMPTY }; // ops backend unavailable: no ops issues rather than an error
  }
  listeners.forEach((l) => l());
}

function start(projectId: string | null) {
  if (polledFor === projectId && timer) return;
  if (timer) clearInterval(timer);
  polledFor = projectId;
  void poll(projectId);
  timer = setInterval(() => void poll(projectId), POLL_MS);
}

export function useOpsProblems(projectId: string | null): OpsProblem[] {
  useEffect(() => {
    users++;
    start(projectId);
    return () => {
      users--;
      if (!users && timer) {
        clearInterval(timer);
        timer = null;
        polledFor = undefined;
      }
    };
  }, [projectId]);
  const snap = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => current,
  );
  return snap.projectId === projectId ? snap.problems : EMPTY;
}

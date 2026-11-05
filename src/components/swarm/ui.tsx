"use client";
import { Ban, Check, CircleDashed, Loader2, Pause, SkipForward, TriangleAlert, type LucideIcon } from "lucide-react";
import type { StepStatus, Swarm, SwarmStatus } from "./api";

export const STEP_META: Record<StepStatus, { label: string; color: string; icon: LucideIcon }> = {
  pending: { label: "Pending", color: "var(--fg-faint)", icon: CircleDashed },
  running: { label: "Running", color: "var(--accent)", icon: Loader2 },
  done: { label: "Done", color: "var(--ok)", icon: Check },
  error: { label: "Failed", color: "var(--err)", icon: TriangleAlert },
  skipped: { label: "Skipped", color: "var(--fg-faint)", icon: SkipForward },
  cancelled: { label: "Cancelled", color: "var(--fg-faint)", icon: Ban },
};

export const SWARM_META: Record<SwarmStatus, { label: string; color: string; icon: LucideIcon }> = {
  planning: { label: "Planning", color: "var(--accent)", icon: Loader2 },
  planned: { label: "Ready to run", color: "var(--warn)", icon: Pause },
  running: { label: "Running", color: "var(--accent)", icon: Loader2 },
  done: { label: "Done", color: "var(--ok)", icon: Check },
  error: { label: "Needs attention", color: "var(--err)", icon: TriangleAlert },
  cancelled: { label: "Cancelled", color: "var(--fg-faint)", icon: Ban },
};

/** Rounded status pill, tinted by status color. */
export function StatusPill({ status, kind = "swarm", className = "" }: { status: SwarmStatus | StepStatus; kind?: "swarm" | "step"; className?: string }) {
  const m = kind === "swarm" ? SWARM_META[status as SwarmStatus] : STEP_META[status as StepStatus];
  const spin = status === "running" || status === "planning";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium leading-[20px] ${className}`}
      style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}
    >
      <m.icon size={11} className={spin ? "animate-spin" : ""} aria-hidden /> {m.label}
    </span>
  );
}

/** Thin bar with one segment per step, colored by step status. */
export function StepBar({ swarm, className = "" }: { swarm: Pick<Swarm, "steps" | "status">; className?: string }) {
  const steps = swarm.steps;
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  if (!steps.length)
    return (
      <span className={`block h-1.5 overflow-hidden rounded-full bg-line ${className}`} aria-hidden>
        {swarm.status === "planning" && <span className="block h-full w-1/3 animate-pulse rounded-full bg-accent/60" />}
      </span>
    );
  return (
    <span className={`flex h-1.5 gap-[2px] ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} steps done`}>
      {steps.map((s) => (
        <span
          key={s.id}
          title={`${s.title} · ${STEP_META[s.status].label}`}
          className={`h-full min-w-[4px] flex-1 rounded-full ${s.status === "running" ? "animate-pulse" : ""}`}
          style={{ background: s.status === "pending" ? "var(--border)" : s.status === "skipped" || s.status === "cancelled" ? "color-mix(in srgb, var(--fg-faint) 45%, transparent)" : STEP_META[s.status].color }}
        />
      ))}
    </span>
  );
}

export function progressOf(swarm: Pick<Swarm, "steps">) {
  const total = swarm.steps.length;
  const done = swarm.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { done, total };
}

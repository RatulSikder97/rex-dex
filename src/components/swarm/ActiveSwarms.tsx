"use client";
import { ArrowRight, Network, Plus } from "lucide-react";
import { Section } from "@/components/mission/ui";
import { elapsed, useNow } from "@/components/mission/data";
import { openSwarm, openSwarmList, useSwarms } from "./api";
import { StatusPill, StepBar, progressOf } from "./ui";

const RECENT_MS = 12 * 3600_000;

/** Mission Pipeline block: running / planned swarms (and ones that just finished) with progress. */
export default function ActiveSwarms({ projectId }: { projectId: string }) {
  const { swarms } = useSwarms(projectId);
  const now = useNow(5000);
  const list = (swarms ?? []).filter((s) => s.status === "planning" || s.status === "running" || s.status === "planned" || (s.finished_at && now - s.finished_at < RECENT_MS));
  const live = list.filter((s) => s.status === "planning" || s.status === "running").length;

  return (
    <Section
      title="Agent swarms"
      count={live}
      hint="Several departments working on one goal in parallel."
      action={
        <button className="btn btn-ghost btn-sm" onClick={() => openSwarmList()}>
          <Network size={13} /> All swarms
        </button>
      }
    >
      {!list.length ? (
        <button
          className="flex h-9 w-full items-center gap-2 rounded-[6px] border border-dashed border-line px-3 text-left text-[12.5px] text-muted hover:bg-hover hover:text-fg"
          onClick={() => openSwarmList(true)}
        >
          <Plus size={14} className="text-faint" aria-hidden /> Start a swarm, or click <b className="font-medium text-fg">Swarm</b> on a task below.
        </button>
      ) : (
        <ul className="overflow-hidden rounded-[6px] border border-line bg-side">
          {list.slice(0, 5).map((s) => {
            const { done, total } = progressOf(s);
            const running = s.steps.filter((x) => x.status === "running").length;
            return (
              <li key={s.id} className="border-b border-line last:border-b-0">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-hover"
                  onClick={() => openSwarm(s)}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]" title={s.goal}>{s.goal.split("\n").find((l) => l.trim()) ?? "Swarm"}</span>
                    <StatusPill status={s.status} />
                  </span>
                  <span className="mt-1.5 flex items-center gap-2.5 text-[11px] text-muted">
                    <StepBar swarm={s} className="flex-1" />
                    <span className="shrink-0 tabular-nums">
                      {total ? `${done}/${total}` : "…"}
                      {running ? ` · ${running} running` : ""}
                      {s.status === "planning" || s.status === "running" ? ` · ${elapsed(s.created_at, now)}` : ""}
                    </span>
                    <ArrowRight size={12} className="shrink-0 text-faint" aria-hidden />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

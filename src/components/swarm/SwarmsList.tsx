"use client";
import { useEffect, useState } from "react";
import { Network, Plus, SquareKanban } from "lucide-react";
import { timeAgo } from "@/lib/client";
import { DeptIcon } from "@/components/icons";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { useActiveProject, useDepartments } from "@/store/workbench";
import SwarmComposer from "./SwarmComposer";
import { SYNTH_KEY, openSwarm, useSwarms, type Swarm } from "./api";
import { StatusPill, StepBar, progressOf } from "./ui";

/** All swarms for the active project. `compose` (a timestamp) opens the composer when recent. */
export default function SwarmsList({ compose }: { compose?: number }) {
  const project = useActiveProject();
  const { swarms, error } = useSwarms(project?.id);
  const [composing, setComposing] = useState(false);

  // Only honor a fresh request (the tab spec is persisted; don't reopen the composer on reload).
  useEffect(() => {
    if (compose && Date.now() - compose < 10_000) setComposing(true);
  }, [compose]);

  const active = (swarms ?? []).filter((s) => s.status === "planning" || s.status === "running" || s.status === "planned");
  const past = (swarms ?? []).filter((s) => !active.includes(s));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Network size={18} className="text-accent" /> Agent swarms
            </h1>
            <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              Give a goal (or a board task) to the Chief of Staff. It plans department steps, runs independent ones in parallel on their terminal agents, passes results down the pipeline and merges everything into one deliverable.
            </p>
          </div>
          <button className="btn btn-primary !h-8 !rounded-lg !px-3" onClick={() => setComposing(true)} disabled={!project}>
            <Plus size={13} /> New swarm
          </button>
        </div>

        {!project && <EmptyState icon={Network} title="No project selected" hint="Pick a project to see its swarms." />}
        {project && !swarms && (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        )}
        {project && error && !swarms?.length && <p className="text-[12.5px] text-err">{error}</p>}
        {project && swarms && !swarms.length && (
          <div className="rounded-xl border border-dashed border-line">
            <EmptyState
              icon={Network}
              title="No swarms yet"
              hint="Start one here, or hover a task on the Board and click Swarm to have several departments work on it together."
              action={{ label: "New swarm", icon: Plus, onClick: () => setComposing(true) }}
            />
          </div>
        )}

        {!!active.length && <Group title="Active" swarms={active} />}
        {!!past.length && <Group title="Finished" swarms={past} />}
      </div>
      {composing && <SwarmComposer onClose={() => setComposing(false)} />}
    </div>
  );
}

function Group({ title, swarms }: { title: string; swarms: Swarm[] }) {
  return (
    <section className="space-y-2">
      <h2 className="section-title">
        {title} · {swarms.length}
      </h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {swarms.map((s) => (
          <SwarmCard key={s.id} swarm={s} />
        ))}
      </div>
    </section>
  );
}

export function SwarmCard({ swarm }: { swarm: Swarm }) {
  const { getDepartment } = useDepartments();
  const { done, total } = progressOf(swarm);
  const depts = [...new Set(swarm.steps.filter((s) => s.key !== SYNTH_KEY).map((s) => s.department))];
  const headline = swarm.goal.split("\n").find((l) => l.trim()) ?? "Swarm";
  return (
    <button
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-elev/30 p-3.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-elev"
      onClick={() => openSwarm(swarm)}
    >
      <span className="flex items-center gap-2">
        <StatusPill status={swarm.status} />
        {swarm.task_id && (
          <span className="flex items-center gap-1 text-[11px] text-faint" title="Linked to a board task">
            <SquareKanban size={11} /> task
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[11px] text-faint">{timeAgo(swarm.created_at)}</span>
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{headline}</span>
      <StepBar swarm={swarm} />
      <span className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="flex -space-x-1">
          {depts.slice(0, 6).map((id) => {
            const d = getDepartment(id);
            return (
              <span key={id} className="grid h-5 w-5 place-items-center rounded-full border border-[var(--bg-elev)]" style={{ background: `color-mix(in srgb, ${d.color} 22%, var(--bg-elev))`, color: d.color }} title={d.name}>
                <DeptIcon name={d.icon} size={10} />
              </span>
            );
          })}
        </span>
        <span className="flex-1" />
        <span className="tabular-nums">{total ? `${done}/${total} steps` : swarm.status === "planning" ? "planning…" : "no plan"}</span>
      </span>
    </button>
  );
}

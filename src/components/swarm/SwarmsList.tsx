"use client";
import { useEffect, useState } from "react";
import { Network, Plus, SquareKanban } from "lucide-react";
import { timeAgo } from "@/lib/client";
import { DeptIcon } from "@/components/icons";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { ErrorState, Page, PageHeader } from "@/components/ui/kit";
import { useActiveProject, useDepartments, useWorkbench } from "@/store/workbench";
import SwarmComposer from "./SwarmComposer";
import { SYNTH_KEY, openSwarm, useSwarms, type Swarm } from "./api";
import { StatusPill, StepBar, progressOf } from "./ui";

const PAGE = 100;

/** All swarms for the active project. `compose` (a timestamp) opens the composer when recent. */
export default function SwarmsList({ compose }: { compose?: number }) {
  const project = useActiveProject();
  const { swarms, error } = useSwarms(project?.id);
  const bump = useWorkbench((s) => s.bump);
  const [composing, setComposing] = useState(false);

  // Only honor a fresh request (the tab spec is persisted; don't reopen the composer on reload).
  useEffect(() => {
    if (compose && Date.now() - compose < 10_000) setComposing(true);
  }, [compose]);

  const active = (swarms ?? []).filter((s) => s.status === "planning" || s.status === "running" || s.status === "planned");
  const past = (swarms ?? []).filter((s) => !active.includes(s));

  return (
    <Page>
      <PageHeader
        title="Swarms"
        description="Several departments work on one goal in parallel, then merge the results into one deliverable."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setComposing(true)} disabled={!project}>
            <Plus size={13} /> New swarm
          </button>
        }
      />

      {!project && <EmptyState icon={Network} title="No project selected" hint="Pick a project to see its swarms." />}
      {project && !swarms && (
        <div className="overflow-hidden rounded-[6px] border border-line" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex h-10 items-center gap-3 border-b border-line px-3 last:border-b-0">
              <Skeleton className="h-[18px] w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-1 w-20" />
            </div>
          ))}
        </div>
      )}
      {project && error && !swarms?.length && <ErrorState title="Couldn’t load swarms" error={`${error}. Check that REX is running, then retry.`} onRetry={bump} />}
      {project && swarms && !swarms.length && !error && (
        <div className="rounded-[6px] border border-dashed border-line">
          <EmptyState
            icon={Network}
            title="No swarms yet"
            hint="Give one goal to several departments at once. You can also start a swarm from a task on the board."
            action={{ label: "New swarm", icon: Plus, onClick: () => setComposing(true) }}
          />
        </div>
      )}

      <div className="space-y-5">
        {!!active.length && <Group title="Running" swarms={active} />}
        {!!past.length && <Group title="Finished" swarms={past} />}
      </div>
      {composing && <SwarmComposer onClose={() => setComposing(false)} />}
    </Page>
  );
}

function Group({ title, swarms }: { title: string; swarms: Swarm[] }) {
  const [limit, setLimit] = useState(PAGE);
  const id = `swarms-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="section-title mb-1.5 flex items-center gap-1.5">
        {title} <span className="count">{swarms.length}</span>
      </h2>
      <ul className="overflow-hidden rounded-[6px] border border-line bg-side">
        {swarms.slice(0, limit).map((s) => (
          <li key={s.id} className="border-b border-line last:border-b-0">
            <SwarmRow swarm={s} />
          </li>
        ))}
      </ul>
      {swarms.length > limit && (
        <button className="btn btn-ghost btn-sm mt-1.5" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({swarms.length - limit})
        </button>
      )}
    </section>
  );
}

/** Dense list row: status · title · departments · step progress · time. */
export function SwarmRow({ swarm }: { swarm: Swarm }) {
  const { getDepartment } = useDepartments();
  const { done, total } = progressOf(swarm);
  const depts = [...new Set(swarm.steps.filter((s) => s.key !== SYNTH_KEY).map((s) => s.department))];
  const headline = swarm.goal.split("\n").find((l) => l.trim()) ?? "Swarm";
  return (
    <button data-swarm-row className="@container flex h-10 w-full min-w-0 items-center gap-3 px-3 text-left hover:bg-hover" onClick={() => openSwarm(swarm)}>
      <span className="w-[112px] shrink-0">
        <StatusPill status={swarm.status} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]" title={headline}>
        {headline}
      </span>
      {swarm.task_id && <SquareKanban size={13} className="shrink-0 text-faint" aria-label="Linked to a board task" />}
      <span className="hidden shrink-0 items-center gap-0.5 @xl:flex" aria-label={depts.map((id) => getDepartment(id).name).join(", ")}>
        {depts.slice(0, 5).map((id) => {
          const d = getDepartment(id);
          return (
            <span key={id} className="grid h-5 w-5 place-items-center rounded-[4px]" style={{ background: `color-mix(in srgb, ${d.color} 18%, transparent)`, color: d.color }} title={d.name}>
              <DeptIcon name={d.icon} size={11} />
            </span>
          );
        })}
      </span>
      <StepBar swarm={swarm} className="w-20 shrink-0" />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted">{total ? `${done}/${total}` : swarm.status === "planning" ? "…" : "—"}</span>
      <span className="w-14 shrink-0 text-right text-[11px] text-faint">{timeAgo(swarm.created_at)}</span>
    </button>
  );
}

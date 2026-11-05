"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { DeptIcon } from "@/components/icons";
import { elapsed, useNow } from "@/components/mission/data";
import { useAgents, useDepartments } from "@/store/workbench";
import { SYNTH_KEY, stepDepths, type Step } from "./api";
import { STEP_META } from "./ui";

interface Edge {
  from: string;
  to: string;
  d: string;
  tone: "done" | "live" | "idle" | "faint";
}

/**
 * The swarm pipeline: steps in columns by dependency depth (0 = no deps … synthesis last),
 * cards connected by SVG curves from each dependency to its dependents. Positions come from
 * the DOM (ResizeObserver), so it stays correct on resize, zoom and card height changes.
 */
export default function SwarmDag({ steps, selected, onSelect }: { steps: Step[]; selected: string | null; onSelect: (id: string) => void }) {
  const columns = useMemo(() => {
    const depth = stepDepths(steps);
    const cols: Step[][] = [];
    for (const s of steps) (cols[depth.get(s.key) ?? 0] ??= []).push(s);
    return cols.filter(Boolean);
  }, [steps]);

  const inner = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const depsSig = steps.map((s) => `${s.key}:${s.status}:${s.depends_on.join(",")}`).join("|");

  useLayoutEffect(() => {
    const root = inner.current;
    if (!root) return;
    const byKey = new Map(steps.map((s) => [s.key, s]));
    const measure = () => {
      const r = root.getBoundingClientRect();
      // CSS zoom (workbench.zoomLevel): rects are visual px, SVG coords are CSS px.
      const k = root.offsetWidth ? r.width / root.offsetWidth : 1;
      const box = (key: string) => {
        const el = cards.current.get(key);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { l: (b.left - r.left) / k, t: (b.top - r.top) / k, w: b.width / k, h: b.height / k };
      };
      const out: Edge[] = [];
      for (const s of steps) {
        const to = box(s.key);
        if (!to) continue;
        for (const dk of s.depends_on) {
          const dep = byKey.get(dk);
          const from = box(dk);
          if (!dep || !from) continue;
          const x1 = from.l + from.w;
          const y1 = from.t + from.h / 2;
          const x2 = to.l;
          const y2 = to.t + to.h / 2;
          const c = Math.max(24, (x2 - x1) / 2);
          const tone: Edge["tone"] =
            s.status === "running" && dep.status === "done" ? "live" : dep.status === "done" ? "done" : dep.status === "skipped" || dep.status === "cancelled" ? "faint" : "idle";
          out.push({ from: dk, to: s.key, d: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`, tone });
        }
      }
      setEdges(out);
      setSize({ w: root.scrollWidth, h: root.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    for (const el of cards.current.values()) ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depsSig captures everything layout-relevant in steps
  }, [depsSig, columns.length]);

  const hi = selected ? steps.find((s) => s.id === selected)?.key : null;

  return (
    <div className="overflow-x-auto overflow-y-hidden pb-2" role="group" aria-label="Swarm pipeline">
      <div ref={inner} className="relative inline-flex min-w-full items-stretch gap-14 p-1">
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={size.w} height={size.h} aria-hidden>
          <defs>
            <marker id="swarm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {edges.map((e) => {
            const on = !!hi && (e.from === hi || e.to === hi);
            const stroke = e.tone === "live" ? "var(--accent)" : e.tone === "done" ? "color-mix(in srgb, var(--ok) 70%, transparent)" : e.tone === "faint" ? "color-mix(in srgb, var(--fg-faint) 40%, transparent)" : "var(--border)";
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={e.d}
                fill="none"
                stroke={on ? "var(--accent)" : stroke}
                strokeWidth={on ? 2 : 1.5}
                strokeDasharray={e.tone === "live" ? "5 5" : e.tone === "idle" ? "3 4" : undefined}
                markerEnd="url(#swarm-arrow)"
              >
                {e.tone === "live" && <animate attributeName="stroke-dashoffset" from="0" to="-10" dur="0.8s" repeatCount="indefinite" />}
              </path>
            );
          })}
        </svg>
        {columns.map((col, i) => (
          <div key={i} className="relative z-10 flex w-[224px] shrink-0 flex-col gap-2" aria-label={col[0]?.key === SYNTH_KEY ? "Synthesis" : `Stage ${i + 1}`}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{col[0]?.key === SYNTH_KEY ? "Synthesis" : i === 0 ? "Parallel start" : `Stage ${i + 1}`}</div>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {col.map((s) => (
                <StepCard
                  key={s.id}
                  step={s}
                  selected={selected === s.id}
                  onSelect={() => onSelect(s.id)}
                  cardRef={(el) => {
                    if (el) cards.current.set(s.key, el);
                    else cards.current.delete(s.key);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, selected, onSelect, cardRef }: { step: Step; selected: boolean; onSelect: () => void; cardRef: (el: HTMLButtonElement | null) => void }) {
  const { getDepartment } = useDepartments();
  const agents = useAgents();
  const now = useNow();
  const d = getDepartment(step.department);
  const m = STEP_META[step.status];
  const agent = step.provider ?? step.agent ?? agents.forDepartment(step.department);
  const auto = !step.provider && !step.agent;
  const faint = step.status === "skipped" || step.status === "cancelled";
  const synth = step.key === SYNTH_KEY;
  const time = step.started_at ? elapsed(step.started_at, step.finished_at ?? (step.status === "running" ? now : step.started_at)) : "";

  return (
    <button
      ref={cardRef}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${step.title}, ${d.name}, ${m.label}`}
      className={`group relative w-full rounded-xl border bg-elev px-3 py-2.5 text-left transition-[border-color,box-shadow,opacity] ${
        selected ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]" : "border-line hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]"
      } ${faint ? "opacity-55" : ""} ${synth ? "bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-elev))]" : ""}`}
    >
      {step.status === "running" && <span className="pointer-events-none absolute inset-0 animate-pulse rounded-xl shadow-[inset_0_0_0_1px_var(--accent)]" aria-hidden />}
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in srgb, ${d.color} 16%, transparent)`, color: d.color }}>
          {synth ? <Sparkles size={11} /> : <DeptIcon name={d.icon} size={11} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{d.name}</span>
        <m.icon size={13} style={{ color: m.color }} className={`shrink-0 ${step.status === "running" ? "animate-spin" : ""}`} aria-hidden />
      </span>
      <span className={`mt-1.5 line-clamp-2 block text-[12.5px] font-medium leading-snug ${faint ? "line-through decoration-faint" : ""}`}>{step.title}</span>
      <span className="mt-2 flex items-center gap-1.5 text-[10.5px]">
        <span className={`min-w-0 truncate rounded-md border px-1.5 leading-[17px] ${auto ? "border-dashed border-line text-faint" : "border-line text-muted"}`} title={auto ? "Department default agent" : "Agent"}>
          {agents.label(agent)}
        </span>
        <span className="flex-1" />
        {time && <span className="shrink-0 tabular-nums" style={{ color: step.status === "running" ? "var(--accent)" : "var(--fg-faint)" }}>{time}</span>}
        {!time && <span className="shrink-0 text-faint">{m.label}</span>}
      </span>
    </button>
  );
}

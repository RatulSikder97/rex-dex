"use client";
import { useEffect, useId, useState } from "react";
import { Loader2, Network, X } from "lucide-react";
import { DeptIcon } from "@/components/icons";
import { Switch } from "@/components/ui/kit";
import { useActiveProject, useDepartments } from "@/store/workbench";
import { createSwarm } from "./api";

/** Modal for a new swarm: goal, optional department restriction, parallelism, file edits, review-before-run. */
export default function SwarmComposer({ onClose, initialGoal = "", taskId }: { onClose: () => void; initialGoal?: string; taskId?: string }) {
  const project = useActiveProject();
  const { departments } = useDepartments();
  const [goal, setGoal] = useState(initialGoal);
  const [depts, setDepts] = useState<string[]>([]);
  const [parallel, setParallel] = useState(3);
  const [edits, setEdits] = useState(false);
  const [review, setReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const specialists = departments.filter((d) => d.id !== "ceo");
  const repoDepts = specialists.filter((d) => d.usesRepo).map((d) => d.name);
  const editsMeaningful = !!project?.repo_path && (!depts.length || specialists.some((d) => d.usesRepo && depts.includes(d.id)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, busy]);

  const submit = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    const s = await createSwarm({
      projectId: project?.id ?? null,
      taskId: taskId ?? null,
      goal: goal.trim(),
      maxParallel: parallel,
      allowEdits: edits && editsMeaningful,
      autoStart: !review,
      departments: depts.length ? depts : undefined,
    });
    setBusy(false);
    if (s) onClose();
  };

  const toggle = (id: string) => setDepts((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="scrim fixed inset-0 z-40 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="swarm-composer-title" className="popover max-h-[92vh] w-[620px] max-w-full overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex h-11 items-center gap-2 border-b border-line px-4">
            <Network size={15} className="text-muted" aria-hidden />
            <h2 id="swarm-composer-title" className="text-[13px] font-semibold">
              New swarm
            </h2>
            {project && <span className="min-w-0 truncate text-[12px] text-muted" title={project.name}>· {project.name}</span>}
            <span className="flex-1" />
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)" disabled={busy}>
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <label className="block">
              <span className="label">Goal</span>
              <textarea
                className="input min-h-[110px]"
                placeholder="e.g. Launch a referral program: landing copy, SEO page, email sequence and an explainer video script"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                autoFocus
              />
              <span className="help block">The Chief of Staff splits it into department steps, runs them in parallel and merges the results.</span>
            </label>

            <fieldset>
              <legend className="label">Departments {depts.length ? `(${depts.length} selected)` : "(any, the Chief of Staff picks)"}</legend>
              <div className="flex flex-wrap gap-1.5">
                {specialists.map((d) => {
                  const on = depts.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(d.id)}
                      className={`flex h-6 items-center gap-1.5 rounded-[4px] border px-2 text-[12px] transition-colors ${on ? "border-accent bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-fg" : "border-line text-muted hover:bg-hover hover:text-fg"}`}
                    >
                      <span style={{ color: d.color }}>
                        <DeptIcon name={d.icon} size={12} />
                      </span>
                      {d.name}
                    </button>
                  );
                })}
                {!!depts.length && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepts([])}>
                    Clear
                  </button>
                )}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Max parallel steps</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={1} max={6} value={parallel} onChange={(e) => setParallel(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label="Max parallel steps" />
                  <span className="w-6 text-right text-[13px] font-semibold tabular-nums" aria-hidden>{parallel}</span>
                </div>
              </label>
              <div className="space-y-2">
                <Toggle
                  checked={review}
                  onChange={setReview}
                  label="Review plan before running"
                  hint={review ? "You approve the plan, edit briefs or swap agents, then start." : "Starts as soon as the plan is ready."}
                />
                <Toggle
                  checked={edits && editsMeaningful}
                  disabled={!editsMeaningful}
                  onChange={setEdits}
                  label="Allow file edits"
                  hint={editsMeaningful ? `${repoDepts.join(" / ") || "Coding"} steps may change files in ${project?.repo_path?.split("/").pop()}.` : project?.repo_path ? "Only for Engineering / QA steps." : "Link a repo to the project to allow edits."}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <span className="hidden text-[11px] text-faint sm:inline">⌘↵ to create</span>
            <span className="flex-1" />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!goal.trim() || busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />} {review ? "Plan swarm" : "Plan and run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${disabled ? "opacity-60" : ""}`}>
      <span className="mt-0.5">
        <Switch id={id} checked={checked} onChange={onChange} label={label} disabled={disabled} />
      </span>
      <label htmlFor={id} className="min-w-0">
        <span className="block text-[12.5px]">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-muted">{hint}</span>}
      </label>
    </div>
  );
}

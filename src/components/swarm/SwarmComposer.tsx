"use client";
import { useEffect, useState } from "react";
import { Loader2, Network, X } from "lucide-react";
import { DeptIcon } from "@/components/icons";
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="swarm-composer-title" className="max-h-[92vh] w-[620px] max-w-full overflow-y-auto rounded-xl border border-line bg-elev shadow-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Network size={15} className="text-accent" />
            <h2 id="swarm-composer-title" className="text-[13.5px] font-semibold">
              New agent swarm
            </h2>
            {project && <span className="truncate text-[12px] text-muted">· {project.name}</span>}
            <span className="flex-1" />
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <label className="block">
              <span className="label">Goal</span>
              <textarea
                className="input !h-auto min-h-[110px] py-1.5 leading-relaxed"
                placeholder="e.g. Launch a referral program: landing copy, SEO page, email sequence and an explainer video script"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                }}
                autoFocus
              />
              <span className="mt-1 block text-[11.5px] text-faint">The Chief of Staff splits it into department steps that run in parallel, then merges the results into one deliverable.</span>
            </label>

            <fieldset>
              <legend className="label">Departments {depts.length ? `(${depts.length} selected)` : "(any — the Chief of Staff picks)"}</legend>
              <div className="flex flex-wrap gap-1.5">
                {specialists.map((d) => {
                  const on = depts.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(d.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-accent bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-fg" : "border-line text-muted hover:text-fg"}`}
                    >
                      <span style={{ color: d.color }}>
                        <DeptIcon name={d.icon} size={12} />
                      </span>
                      {d.name}
                    </button>
                  );
                })}
                {!!depts.length && (
                  <button type="button" className="px-1 text-[11.5px] text-accent hover:underline" onClick={() => setDepts([])}>
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
                  <span className="w-6 text-right text-[13px] font-semibold tabular-nums">{parallel}</span>
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
            <span className="hidden text-[11.5px] text-faint sm:inline">⌘↵ to create</span>
            <span className="flex-1" />
            <button type="button" className="btn !h-8 !rounded-lg" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary !h-8 !rounded-lg !px-3" disabled={!goal.trim() || busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />} {review ? "Plan swarm" : "Plan & run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-start gap-2.5 text-left disabled:opacity-50">
      <span className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${checked ? "left-[16px]" : "left-[2px]"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px]">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-faint">{hint}</span>}
      </span>
    </button>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Mic, Plus, Podcast, RefreshCw, Trash2 } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { JobKind, JobStatus, MediaJob } from "@/lib/media/plan";
import { useWorkbench } from "@/store/workbench";
import { ErrorState, LoadingRows } from "@/components/ui/kit";

type JobSummary = Omit<MediaJob, "logs">;

const KIND_ICON: Record<JobKind, typeof Clapperboard> = { video: Clapperboard, voiceover: Mic, podcast: Podcast };

function dotClass(s: JobStatus): string {
  if (s === "running") return "animate-pulse bg-accent";
  if (s === "queued") return "bg-warn";
  if (s === "done") return "bg-ok";
  if (s === "error") return "bg-err";
  return "bg-faint";
}

export default function CreatePanel() {
  const { openTab, version, bump } = useWorkbench();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(
    () =>
      api<JobSummary[]>("/api/create/jobs")
        .then((j) => {
          setJobs(j);
          setError(null);
        })
        .catch((e) => setError(e)),
    [],
  );

  useEffect(() => {
    load();
  }, [load, version]);

  const active = (jobs ?? []).some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  const remove = async (id: string) => {
    await api(`/api/create/jobs/${id}`, { method: "DELETE" }).catch(() => {});
    load();
    bump();
  };

  const open = (j: JobSummary) => openTab({ kind: "create", jobId: j.id }, j.title);

  return (
    <div className="pb-3">
      <div className="flex gap-1 px-3 pb-2">
        <button className="btn btn-primary btn-sm flex-1 justify-center" onClick={() => openTab({ kind: "create" }, "Create studio")}>
          <Plus size={13} /> New creation
        </button>
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>
      {error && !jobs ? (
        <ErrorState compact title="Couldn’t load productions" error={error} onRetry={load} />
      ) : !jobs ? (
        <LoadingRows rows={3} height={18} className="px-3" />
      ) : jobs.length > 0 ? (
        <>
          <div className="section-title px-3 pb-1">Recent</div>
          <div role="list">
            {jobs.map((j) => {
              const Icon = KIND_ICON[j.kind] ?? Clapperboard;
              return (
                <div
                  key={j.id}
                  role="listitem"
                  tabIndex={0}
                  onClick={() => open(j)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(j);
                    }
                  }}
                  className="row group !pr-1"
                  title={`${j.title} · ${j.status}${j.status === "running" ? ` ${j.progress}% · ${j.step}` : ""}${j.error ? ` · ${j.error}` : ""}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(j.status)}`} aria-hidden />
                  <Icon size={13} className="shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{j.title}</span>
                  {j.status === "running" ? (
                    <span className="shrink-0 pr-2 text-[11px] tabular-nums text-accent">{j.progress}%</span>
                  ) : (
                    <span className="shrink-0 pr-2 text-[11px] text-faint group-focus-within:hidden group-hover:hidden">{timeAgo(j.created_at)}</span>
                  )}
                  <button
                    className="icon-btn hidden group-focus-within:inline-flex group-hover:inline-flex"
                    aria-label={`Remove ${j.title} from list`}
                    title="Remove from list (keeps the media file)"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(j.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="px-3 text-[12px] leading-relaxed text-muted">
          Turn a brief into a narrated video, a voiceover or a two-host podcast. Draft the script with an agent, edit it, then produce.
        </p>
      )}
    </div>
  );
}

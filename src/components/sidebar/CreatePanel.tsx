"use client";
import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Mic, Plus, Podcast, RefreshCw, Trash2 } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { JobKind, JobStatus, MediaJob } from "@/lib/media/plan";
import { useWorkbench } from "@/store/workbench";

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
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const load = useCallback(() => api<JobSummary[]>("/api/create/jobs").then(setJobs).catch(() => {}), []);

  useEffect(() => {
    load();
  }, [load, version]);

  const active = jobs.some((j) => j.status === "running" || j.status === "queued");
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

  return (
    <div className="pb-3">
      <div className="flex gap-2 px-3 pb-2">
        <button className="btn btn-primary flex-1 justify-center" onClick={() => openTab({ kind: "create" }, "Create Studio")}>
          <Plus size={13} /> New creation
        </button>
        <button className="icon-btn" title="Refresh" onClick={load}>
          <RefreshCw size={13} />
        </button>
      </div>
      {jobs.length > 0 && <div className="px-3 pb-1 text-[11px] text-muted">RECENT</div>}
      {jobs.map((j) => {
        const Icon = KIND_ICON[j.kind] ?? Clapperboard;
        return (
          <div
            key={j.id}
            onClick={() => openTab({ kind: "create", jobId: j.id }, j.title)}
            className="group flex h-[26px] cursor-pointer items-center gap-2 px-3 text-[12.5px] text-fg hover:bg-hover"
            title={`${j.title} · ${j.status}${j.status === "running" ? ` ${j.progress}% · ${j.step}` : ""}${j.error ? ` · ${j.error}` : ""}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(j.status)}`} />
            <Icon size={13} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">{j.title}</span>
            {j.status === "running" ? (
              <span className="shrink-0 text-[10.5px] text-accent">{j.progress}%</span>
            ) : (
              <span className="shrink-0 text-[10.5px] text-faint group-hover:hidden">{timeAgo(j.created_at)}</span>
            )}
            <button
              className="icon-btn hidden h-5 w-5 group-hover:inline-flex"
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
      {!jobs.length && (
        <p className="px-3 text-[12px] leading-relaxed text-muted">
          Turn a brief into a narrated video, a voiceover or a two-host podcast. Draft the script with AI, edit it, then produce.
        </p>
      )}
    </div>
  );
}

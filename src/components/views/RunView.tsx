"use client";
import { useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { useEffect, useState } from "react";
import { Copy, Loader2, Square } from "lucide-react";
import { api, applyChunk, streamRun, timeAgo } from "@/lib/client";
import type { Run, RunStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { ErrorState, Pill, type Tone } from "@/components/ui/kit";
import { Skeleton } from "@/components/ui/empty";

const STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "accent" },
  done: { label: "Done", tone: "ok" },
  error: { label: "Failed", tone: "err" },
  cancelled: { label: "Stopped", tone: "neutral" },
};

export default function RunView({ id }: { id: string }) {
  const { getDepartment } = useDepartments();
  const { label } = useAgents();
  const log = useWorkbench((s) => s.log);
  const [run, setRun] = useState<Run | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    // `cancelled` guards the async gap: without it a re-run effect (React dev double-invoke,
    // fast tab switches) left a second stream open and every chunk was appended twice.
    let cancelled = false;
    let close = () => {};
    setLoadError(null);
    api<Run>(`/api/runs/${id}`)
      .then((r) => {
        if (cancelled) return;
        setRun(r);
        if (r.status === "running") {
          close = streamRun(id, (ev) =>
            setRun((cur) => {
              if (!cur) return cur;
              if (ev.type === "chunk") return { ...cur, output: applyChunk(cur.output, ev) };
              if (ev.type === "snapshot") return { ...cur, output: ev.output, status: ev.status, error: ev.error ?? null };
              return { ...cur, status: ev.status, error: ev.error ?? null };
            }),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e);
      });
    return () => {
      cancelled = true;
      close();
    };
  }, [id, attempt]);

  if (!run)
    return loadError ? (
      <ErrorState title="Couldn’t load this run" error={loadError} onRetry={() => setAttempt((n) => n + 1)} />
    ) : (
      <div className="mx-auto max-w-3xl space-y-3 p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  const d = getDepartment(run.department);
  const st = STATUS[run.status] ?? { label: run.status, tone: "neutral" as Tone };

  const stop = async () => {
    setStopping(true);
    try {
      await api(`/api/runs/${id}/cancel`, { method: "POST" });
    } catch (e) {
      log("error", "runs", `Couldn’t stop the run: ${String(e)}`);
    } finally {
      setStopping(false);
    }
  };
  const copy = () =>
    navigator.clipboard.writeText(run.output).then(
      () => log("ok", "runs", "Output copied"),
      () => log("error", "runs", "Couldn’t copy. Select the text and copy it manually."),
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 px-6 py-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-muted">
          <DeptIcon name={d.icon} color={d.color} size={14} />
          <span className="font-medium text-fg">{d.name}</span>
          <Pill tone={st.tone}>{st.label}</Pill>
          <span className="truncate">
            {label(run.provider)} · {timeAgo(run.created_at)}
          </span>
          <div className="flex-1" />
          {run.status === "running" && (
            <button className="btn btn-sm" onClick={stop} disabled={stopping}>
              {stopping ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />} Stop
            </button>
          )}
          <button className="btn btn-sm" onClick={copy} disabled={!run.output}>
            <Copy size={12} /> Copy output
          </button>
        </div>
        <div className="card whitespace-pre-wrap px-3 py-2 text-[13px]">{run.brief}</div>
        <Markdown text={run.output || (run.status === "running" ? "" : "_No output_")} streaming={run.status === "running"} />
        {run.error && (
          <div role="alert" className="rounded-[6px] border px-3 py-2 text-[12.5px] text-err" style={{ borderColor: "color-mix(in srgb, var(--err) 40%, var(--border))", background: "color-mix(in srgb, var(--err) 8%, transparent)" }}>
            {run.error}
          </div>
        )}
      </div>
    </div>
  );
}

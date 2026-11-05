"use client";
import { useAgents, useDepartments } from "@/store/workbench";
import { useEffect, useState } from "react";
import { Copy, Square } from "lucide-react";
import { api, applyChunk, streamRun, timeAgo } from "@/lib/client";
import type { Run } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";

export default function RunView({ id }: { id: string }) {
  const { getDepartment } = useDepartments();
  const { label } = useAgents();
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    // `cancelled` guards the async gap: without it a re-run effect (React dev double-invoke,
    // fast tab switches) left a second stream open and every chunk was appended twice.
    let cancelled = false;
    let close = () => {};
    api<Run>(`/api/runs/${id}`).then((r) => {
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
    });
    return () => {
      cancelled = true;
      close();
    };
  }, [id]);
  if (!run) return <div className="p-6 text-muted">Loading…</div>;
  const d = getDepartment(run.department);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <DeptIcon name={d.icon} color={d.color} size={14} /> {d.name} · {label(run.provider)} · {timeAgo(run.created_at)} · {run.status}
          <div className="flex-1" />
          {run.status === "running" && (
            <button className="btn" onClick={() => api(`/api/runs/${id}/cancel`, { method: "POST" })}>
              <Square size={11} /> Stop
            </button>
          )}
          <button className="btn" onClick={() => navigator.clipboard.writeText(run.output)}>
            <Copy size={12} /> Copy
          </button>
        </div>
        <div className="rounded-md bg-elev px-3 py-2 whitespace-pre-wrap">{run.brief}</div>
        <Markdown text={run.output || (run.status === "running" ? "" : "_No output_")} streaming={run.status === "running"} />
        {run.error && <div className="rounded border border-err/40 bg-err/10 px-3 py-2 text-err">{run.error}</div>}
      </div>
    </div>
  );
}

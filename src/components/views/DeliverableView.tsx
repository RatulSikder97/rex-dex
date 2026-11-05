"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Download, Eye, Loader2, Pencil, Save } from "lucide-react";
import { api, download, svgDataUrl, timeAgo } from "@/lib/client";
import type { Deliverable } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { useWorkbench, useDepartments } from "@/store/workbench";
import { ErrorState, Pill } from "@/components/ui/kit";
import { Skeleton } from "@/components/ui/empty";

export default function DeliverableView({ tabId, id }: { tabId: string; id: string }) {
  const { getDepartment } = useDepartments();
  const { setTabDirty, log, bump, delegate } = useWorkbench();
  const [d, setD] = useState<Deliverable | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api<Deliverable>(`/api/deliverables/${id}`)
      .then((x) => {
        setD(x);
        setDraft(x.content);
      })
      .catch((e) => setLoadError(e));
  }, [id]);
  useEffect(load, [load]);

  if (!d)
    return loadError ? (
      <ErrorState title="Couldn’t open this deliverable" error={loadError} onRetry={load} />
    ) : (
      <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="mx-auto w-full max-w-3xl space-y-2 p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    );
  const dept = getDepartment(d.department);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api<Deliverable>(`/api/deliverables/${id}`, { method: "PATCH", json: { content: draft } });
      setD(updated);
      setTabDirty(tabId, false);
      setEditing(false);
      bump();
      log("ok", "library", `Saved "${d.title}"`);
    } catch (e) {
      log("error", "library", `Couldn’t save "${d.title}": ${String(e)}. Your edits are still here; try again.`);
    } finally {
      setSaving(false);
    }
  };

  const ext = d.kind === "svg" ? "svg" : d.kind === "html" ? "html" : d.kind === "json" ? "json" : "md";
  const fileName = `${d.title.replace(/[^\w-]+/g, "-").slice(0, 60)}.${ext}`;

  return (
    <div className="@container flex h-full flex-col">
      <div role="toolbar" aria-label="Deliverable" className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <DeptIcon name={dept.icon} color={dept.color} size={14} />
        <span className="min-w-0 truncate text-[13px] font-medium" title={d.title}>
          {d.title}
        </span>
        <Pill className="shrink-0">{dept.name}</Pill>
        <span className="hidden shrink-0 text-[11px] text-faint @lg:inline">{timeAgo(d.updated_at)}</span>
        <div className="flex-1" />
        <button
          className="btn btn-ghost btn-sm shrink-0"
          title={`Ask ${dept.name} to improve this`}
          onClick={() => delegate({ department: d.department, brief: "Improve this deliverable: ", context: `Document: ${d.title}\n\n${draft}` })}
        >
          <Bot size={13} /> Improve
        </button>
        <button className="btn btn-sm shrink-0" title={`Download ${fileName}`} onClick={() => download(fileName, draft, d.kind === "svg" ? "image/svg+xml" : "text/plain")}>
          <Download size={13} /> Export
        </button>
        {editing && (
          <button className="btn btn-sm shrink-0" onClick={() => setEditing(false)}>
            <Eye size={13} /> Preview
          </button>
        )}
        {editing ? (
          <button className="btn btn-primary btn-sm shrink-0" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        ) : (
          <button className="btn btn-sm shrink-0" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <textarea
            className="h-full w-full resize-none bg-editor p-6 font-mono text-[12.5px] leading-relaxed"
            style={{ outline: "none" }}
            aria-label={`Edit ${d.title}`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTabDirty(tabId, e.target.value !== d.content);
            }}
          />
        ) : d.kind === "svg" ? (
          <div
            className="flex h-full items-center justify-center bg-[length:20px_20px] p-8"
            style={{ backgroundImage: "repeating-conic-gradient(color-mix(in srgb, var(--fg) 7%, transparent) 0 25%, transparent 0 50%)" }}
          >
            <img alt={d.title} src={svgDataUrl(draft)} className="max-h-full max-w-full border border-line" />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-6 py-5">
            <Markdown text={draft} />
          </div>
        )}
      </div>
    </div>
  );
}

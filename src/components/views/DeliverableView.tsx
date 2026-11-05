"use client";
import { useEffect, useState } from "react";
import { Bot, Download, Eye, Pencil, Save } from "lucide-react";
import { api, download, svgDataUrl } from "@/lib/client";
import type { Deliverable } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { useWorkbench, useDepartments } from "@/store/workbench";

export default function DeliverableView({ tabId, id }: { tabId: string; id: string }) {
  const { getDepartment } = useDepartments();
  const { setTabDirty, log, bump, delegate } = useWorkbench();
  const [d, setD] = useState<Deliverable | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<Deliverable>(`/api/deliverables/${id}`)
      .then((x) => {
        setD(x);
        setDraft(x.content);
      })
      .catch((e) => log("error", "library", String(e)));
  }, [id, log]);

  if (!d) return <div className="p-6 text-muted">Loading…</div>;
  const dept = getDepartment(d.department);

  const save = async () => {
    const updated = await api<Deliverable>(`/api/deliverables/${id}`, { method: "PATCH", json: { content: draft } });
    setD(updated);
    setTabDirty(tabId, false);
    setEditing(false);
    bump();
    log("ok", "library", `Saved "${d.title}"`);
  };

  const ext = d.kind === "svg" ? "svg" : d.kind === "html" ? "html" : d.kind === "json" ? "json" : "md";
  const fileName = `${d.title.replace(/[^\w-]+/g, "-").slice(0, 60)}.${ext}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-line px-4">
        <DeptIcon name={dept.icon} color={dept.color} size={14} />
        <span className="truncate font-medium">{d.title}</span>
        <span className="text-[11px] text-faint">{dept.name}</span>
        <div className="flex-1" />
        <button className="btn btn-ghost" onClick={() => delegate({ department: d.department, brief: "Improve this deliverable: ", context: `Document: ${d.title}\n\n${draft}` })}>
          <Bot size={13} /> Iterate with AI
        </button>
        <button className="btn" onClick={() => download(fileName, draft, d.kind === "svg" ? "image/svg+xml" : "text/plain")}>
          <Download size={13} /> Export
        </button>
        {editing ? (
          <button className="btn btn-primary" onClick={save}>
            <Save size={13} /> Save
          </button>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </button>
        )}
        {editing && (
          <button className="btn" onClick={() => setEditing(false)}>
            <Eye size={13} /> Preview
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <textarea
            className="h-full w-full resize-none bg-editor p-6 font-mono text-[12.5px] leading-relaxed outline-none"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTabDirty(tabId, e.target.value !== d.content);
            }}
          />
        ) : d.kind === "svg" ? (
          <div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-8">
            <img alt={d.title} src={svgDataUrl(draft)} className="max-h-full max-w-full shadow-xl" />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl p-6">
            <Markdown text={draft} />
          </div>
        )}
      </div>
    </div>
  );
}

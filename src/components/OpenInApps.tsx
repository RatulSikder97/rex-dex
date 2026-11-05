"use client";
import { useEffect, useRef, useState } from "react";
import { AppWindow, Cable, ChevronDown } from "lucide-react";
import { api } from "@/lib/client";
import type { ConnectionInfo } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useWorkbench } from "@/store/workbench";

type Action = ConnectionInfo["actions"][number];
const ACTION_LABEL: Record<Action, string> = {
  "open-media": "Open in",
  "export-fcpxml": "Edit timeline in",
  "export-ae-jsx": "Build comp in",
};

const kindOf = (name: string): "video" | "audio" | "image" =>
  /\.(mp4|mov|m4v|webm|mkv|gif)$/i.test(name) ? "video" : /\.(mp3|wav|m4a|aac)$/i.test(name) ? "audio" : "image";

/**
 * "Open in…" for a media file: hands it to connected desktop apps (Premiere
 * Pro, After Effects, Resolve, Photoshop, …): open directly, or export an
 * editable timeline / comp with REX's scene plan.
 */
export default function OpenInApps({ media, className = "btn h-7" }: { media: string; className?: string }) {
  const { log, openTab } = useWorkbench();
  const [apps, setApps] = useState<ConnectionInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api<ConnectionInfo[]>("/api/connections")
      .then((l) => setApps(l.filter((c) => c.kind === "app" && c.installed)))
      .catch(() => setApps([]));
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const kind = kindOf(media);
  const items = (apps ?? []).flatMap((c) =>
    c.actions
      .filter((a) => a === "open-media" || kind === "video")
      .filter((a) => a !== "open-media" || kind !== "audio" || c.category === "video")
      .map((a) => ({ c, a })),
  );

  const run = async (c: ConnectionInfo, a: Action) => {
    setOpen(false);
    setBusy(true);
    try {
      const openApp = !!c.appPath;
      const r = await api<{ file: string; name?: string; opened: boolean }>(`/api/connections/${c.id}`, { method: "POST", json: { action: a, media, ...(a === "open-media" ? {} : { open: openApp }) } });
      log("ok", c.name, r.opened ? `${ACTION_LABEL[a]} ${c.name}: ${media}` : `Exported ${r.name} to media/exports (install ${c.name} to open it directly)`);
    } catch (e) {
      log("error", c.name, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button className={className} onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open} title="Open or finish this file in a desktop app">
        <AppWindow size={13} /> {busy ? "Opening…" : "Open in"} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 w-72 rounded-lg border border-line bg-elev p-1 shadow-[0_12px_32px_rgba(0,0,0,.45)]" role="menu">
          {!apps && <div className="px-2.5 py-2 text-[12px] text-muted">Loading…</div>}
          {apps && !items.length && <div className="px-2.5 py-2 text-[12px] text-muted">No desktop-app connections for this file yet.</div>}
          {items.map(({ c, a }) => (
            <button
              key={`${c.id}:${a}`}
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover"
              onClick={() => void run(c, a)}
              title={c.appPath ? c.appPath : `${c.name} not found: the export is saved to media/exports`}
            >
              <DeptIcon name={c.icon} size={14} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px]">
                  {ACTION_LABEL[a]} {c.name}
                </span>
                <span className="block truncate text-[11px] text-faint">
                  {a === "export-fcpxml" ? "XML timeline with scene markers" : a === "export-ae-jsx" ? "Script: footage, markers, title layers" : c.appPath ? "Opens the file" : "App not installed"}
                </span>
              </span>
              {!c.appPath && <span className="text-[10px] text-warn">export only</span>}
            </button>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-hover hover:text-fg"
              onClick={() => {
                setOpen(false);
                openTab({ kind: "connections", category: "video" }, "Connections");
              }}
            >
              <Cable size={13} /> Connect more apps…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

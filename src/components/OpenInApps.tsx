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
export default function OpenInApps({ media, className = "btn btn-sm" }: { media: string; className?: string }) {
  const { log, openTab } = useWorkbench();
  const [apps, setApps] = useState<ConnectionInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    api<ConnectionInfo[]>("/api/connections")
      .then((l) => setApps(l.filter((c) => c.kind === "app" && c.installed)))
      .catch(() => setApps([]));
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(document.activeElement as HTMLElement);
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
    };
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
      <button ref={trigger} className={className} onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open} title="Open or finish this file in a desktop app">
        <AppWindow size={13} aria-hidden /> {busy ? "Opening…" : "Open in"} <ChevronDown size={11} aria-hidden />
      </button>
      {open && (
        <div className="popover absolute right-0 top-full z-40 mt-1 w-72 py-1" role="menu" aria-label="Open in a desktop app">
          {!apps && <div className="px-3 py-2 text-[12px] text-muted">Looking for desktop apps…</div>}
          {apps && !items.length && <div className="px-3 py-2 text-[12px] text-muted">No desktop-app connections for this file yet.</div>}
          {items.map(({ c, a }) => (
            <button
              key={`${c.id}:${a}`}
              role="menuitem"
              className="mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-[4px] px-2 py-1 text-left outline-none hover:bg-hover focus-visible:bg-active"
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
              {!c.appPath && <span className="pill pill-warn">Export only</span>}
            </button>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <button
              role="menuitem"
              className="mx-1 flex h-[24px] w-[calc(100%-8px)] items-center gap-2 rounded-[4px] px-2 text-left text-[12.5px] text-muted outline-none hover:bg-hover hover:text-fg focus-visible:bg-active"
              onClick={() => {
                setOpen(false);
                openTab({ kind: "connections", category: "video" }, "Connections");
              }}
            >
              <Cable size={13} aria-hidden /> Connect more apps…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

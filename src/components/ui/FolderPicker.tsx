"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronRight, Folder, FolderGit2, FolderPlus, Home, MonitorUp, Pencil, X } from "lucide-react";
import { api } from "@/lib/client";
import { desktop } from "@/lib/desktop";
import { isDialogOpen, promptDialog } from "./dialog";

/**
 * Folder explorer dialog. `pickFolder()` opens it and resolves to an absolute
 * path (or null). It offers the OS's native picker (Finder on macOS — REX's
 * server runs on this machine) and an in-app explorer with quick places,
 * breadcrumbs, git badges and New Folder.
 */

export interface PickFolderOptions {
  title?: string;
  message?: string;
  startIn?: string | null;
  confirmLabel?: string;
}

interface Listing {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string; path: string; git: boolean }[];
  places: { label: string; path: string }[];
  git: boolean;
}

type Pending = { opts: PickFolderOptions; resolve: (p: string | null) => void; id: number };
let seq = 0;
let open: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];

export function pickFolder(opts: PickFolderOptions = {}): Promise<string | null> {
  // Desktop app: the OS folder dialog directly (in-app explorer only if the bridge fails).
  const d = desktop();
  if (d) return d.pickFolder({ title: opts.title, message: opts.message, defaultPath: opts.startIn, buttonLabel: opts.confirmLabel }).catch(() => explorer(opts));
  return explorer(opts);
}

function explorer(opts: PickFolderOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const p = { opts, resolve, id: ++seq };
    if (open) open(p);
    else queue.push(p);
  });
}

const systemName = () => {
  const p = typeof navigator === "undefined" ? "" : ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "");
  return /mac/i.test(p) ? "Finder" : /win/i.test(p) ? "File Explorer" : "Files";
};

export function FolderPickerHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    open = (p) => setPending((cur) => (cur ? (queue.push(p), cur) : p));
    const q = queue.shift();
    if (q) setPending(q);
    return () => {
      open = null;
    };
  }, []);
  if (!pending) return null;
  const done = (path: string | null) => {
    pending.resolve(path);
    setPending(queue.shift() ?? null);
  };
  return <Picker key={pending.id} opts={pending.opts} onDone={done} />;
}

function Picker({ opts, onDone }: { opts: PickFolderOptions; onDone: (p: string | null) => void }) {
  const [list, setList] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeSupported, setNativeSupported] = useState(true);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(async (p?: string | null) => {
    try {
      const l = await api<Listing>(`/api/system/dirs${p ? `?path=${encodeURIComponent(p)}` : ""}`);
      setList(l);
      setSelected(l.path);
      setPathInput(l.path);
      setActive(0);
      setError(null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void go(opts.startIn);
  }, [go, opts.startIn]);

  const native = async () => {
    setNativeBusy(true);
    try {
      const d = desktop();
      if (d) {
        const p = await d.pickFolder({ title: opts.title, message: opts.message, defaultPath: list?.path, buttonLabel: opts.confirmLabel });
        if (p) onDone(p);
        return;
      }
      const r = await api<{ path: string | null; supported: boolean }>("/api/system/pick-folder", { method: "POST", json: { prompt: opts.title ?? "Choose a folder", startIn: list?.path } });
      if (!r.supported) setNativeSupported(false);
      else if (r.path) onDone(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNativeBusy(false);
    }
  };

  const newFolder = async () => {
    if (!list) return;
    const name = await promptDialog({ title: "New folder", message: `Inside ${list.path}`, placeholder: "my-new-app", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const r = await api<{ path: string }>("/api/system/dirs", { method: "POST", json: { parent: list.path, name: name.trim() } });
      await go(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const crumbs = useMemo(() => {
    if (!list) return [];
    const parts = list.path.split("/").filter(Boolean);
    return parts.map((name, i) => ({ name, path: "/" + parts.slice(0, i + 1).join("/") }));
  }, [list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || isDialogOpen()) return;
      const entries = list?.entries ?? [];
      if (e.key === "Escape") {
        e.preventDefault();
        onDone(null);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => {
          const n = Math.max(0, Math.min(entries.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
          if (entries[n]) setSelected(entries[n].path);
          return n;
        });
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) onDone(selected);
        else if (entries[active]) void go(entries[active].path);
      } else if ((e.key === "Backspace" || (e.key === "ArrowUp" && e.metaKey)) && list?.parent && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void go(list.parent);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list, active, selected, editing, go, onDone]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)} role="dialog" aria-modal="true" aria-label={opts.title ?? "Choose a folder"}>
      <div className="flex h-[min(620px,90vh)] w-[min(820px,96vw)] flex-col overflow-hidden rounded-xl border border-line bg-elev shadow-[0_24px_64px_rgba(0,0,0,.5)]">
        {/* header */}
        <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{opts.title ?? "Choose a folder"}</h2>
            {opts.message && <p className="mt-0.5 text-[12px] text-muted">{opts.message}</p>}
          </div>
          {nativeSupported && (
            <button className="btn btn-primary h-8 !rounded-lg" onClick={() => void native()} disabled={nativeBusy} title={`Use the ${systemName()} folder picker`}>
              <MonitorUp size={14} /> {nativeBusy ? `Waiting for ${systemName()}…` : `Choose in ${systemName()}…`}
            </button>
          )}
          <button className="icon-btn" onClick={() => onDone(null)} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* path bar */}
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <button className="icon-btn" onClick={() => list?.parent && void go(list.parent)} disabled={!list?.parent} title="Up (⌫)" aria-label="Up">
            <ArrowUp size={14} />
          </button>
          {editing ? (
            <form
              className="flex min-w-0 flex-1 gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void go(pathInput.replace(/^~(?=\/|$)/, list?.home ?? "~"));
              }}
            >
              <input className="input h-7 font-mono text-[12px]" autoFocus value={pathInput} onChange={(e) => setPathInput(e.target.value)} onBlur={() => setEditing(false)} aria-label="Folder path" />
            </form>
          ) : (
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto text-[12.5px]" onDoubleClick={() => setEditing(true)}>
              <button className="shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg" onClick={() => void go("/")}>
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex shrink-0 items-center">
                  {i > 0 && <ChevronRight size={12} className="text-faint" />}
                  <button className={`rounded px-1.5 py-0.5 hover:bg-hover ${i === crumbs.length - 1 ? "font-medium text-fg" : "text-muted hover:text-fg"}`} onClick={() => void go(c.path)}>
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <button className="icon-btn" onClick={() => setEditing((v) => !v)} title="Type a path" aria-label="Type a path">
            <Pencil size={13} />
          </button>
          <button className="icon-btn" onClick={() => void newFolder()} title="New folder" aria-label="New folder">
            <FolderPlus size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* places */}
          <nav className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r border-line p-2" aria-label="Places">
            <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Places</div>
            {list?.places.map((p) => (
              <button
                key={p.path}
                onClick={() => void go(p.path)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${list.path === p.path ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
              >
                {p.label === "Home" ? <Home size={13} /> : <Folder size={13} />} <span className="truncate">{p.label}</span>
              </button>
            ))}
          </nav>

          {/* folders */}
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Folders">
            {error && <div className="m-2 rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-[12px] text-err">{error}</div>}
            {!list && !error && <div className="p-4 text-[12px] text-muted">Loading…</div>}
            {list && !list.entries.length && <div className="p-6 text-center text-[12px] text-muted">No folders here. Choose this folder, or create one.</div>}
            {list?.entries.map((e, i) => (
              <button
                key={e.path}
                data-i={i}
                role="option"
                aria-selected={selected === e.path}
                onClick={() => {
                  setSelected(e.path);
                  setActive(i);
                }}
                onDoubleClick={() => void go(e.path)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${selected === e.path ? "bg-accent/15 text-fg" : "hover:bg-hover"}`}
              >
                {e.git ? <FolderGit2 size={15} className="shrink-0 text-accent" /> : <Folder size={15} className="shrink-0 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.git && <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] text-accent">git</span>}
                <ChevronRight size={13} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-faint">Selected</div>
            <div className="truncate font-mono text-[12px]" title={selected ?? ""}>
              {selected ?? "—"}
            </div>
          </div>
          <span className="hidden text-[11px] text-faint sm:inline">Double-click to open · ⌘↵ choose</span>
          <button className="btn h-8 !rounded-lg" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="btn btn-primary h-8 !rounded-lg" onClick={() => onDone(selected)} disabled={!selected}>
            <Check size={14} /> {opts.confirmLabel ?? "Choose folder"}
          </button>
        </div>
      </div>
    </div>
  );
}

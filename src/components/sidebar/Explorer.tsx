"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";

interface FsEntry { name: string; path: string; dir: boolean }

/** Inline editor row state: creating inside `parent`, or renaming `path`. */
type Pending = { kind: "file" | "folder"; parent: string } | { kind: "rename"; path: string; dir: boolean };

interface ExplorerCtx {
  projectId: string;
  /** Per-directory reload counters ("" = root), plus a global one. */
  versions: Record<string, number>;
  global: number;
  open: Record<string, boolean>;
  setOpen: (path: string, open: boolean) => void;
  pending: Pending | null;
  setPending: (p: Pending | null) => void;
  reload: (dir: string) => void;
  run: (op: "create" | "mkdir" | "rename" | "delete", path: string, to?: string) => Promise<boolean>;
}

const Ctx = createContext<ExplorerCtx | null>(null);
const useExplorer = () => useContext(Ctx)!;

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function NameInput({ depth, dir, initial, onSubmit, onCancel }: { depth: number; dir: boolean; initial: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the stem like VS Code does when renaming.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, !dir && dot > 0 ? dot : initial.length);
  }, [initial, dir]);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (submit && name && name !== initial) onSubmit(name);
    else onCancel();
  };
  return (
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="w-[13px]" />
      {dir ? <Folder size={14} className="text-[#e5c07b]" /> : <File size={14} className="text-faint" />}
      <input
        ref={ref}
        className="input !h-[20px] !px-1 !text-[12.5px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

function EntryRow({ e, depth }: { e: FsEntry; depth: number }) {
  const x = useExplorer();
  const { openTab } = useWorkbench();
  const isOpen = !!x.open[e.path];
  const renaming = x.pending?.kind === "rename" && x.pending.path === e.path;

  if (renaming)
    return (
      <NameInput
        depth={depth}
        dir={e.dir}
        initial={e.name}
        onCancel={() => x.setPending(null)}
        onSubmit={async (name) => {
          x.setPending(null);
          const to = join(parentOf(e.path), name);
          if (await x.run("rename", e.path, to)) x.reload(parentOf(e.path));
        }}
      />
    );

  const startCreate = (kind: "file" | "folder") => {
    x.setOpen(e.path, true);
    x.setPending({ kind, parent: e.path });
  };

  return (
    <div
      className="group flex h-[22px] cursor-pointer items-center gap-1 pr-1 text-[12.5px] hover:bg-hover"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={e.path}
      onClick={() => (e.dir ? x.setOpen(e.path, !isOpen) : openTab({ kind: "file", projectId: x.projectId, path: e.path }, e.name))}
    >
      {e.dir ? isOpen ? <ChevronDown size={13} className="text-faint" /> : <ChevronRight size={13} className="text-faint" /> : <span className="w-[13px]" />}
      {e.dir ? isOpen ? <FolderOpen size={14} className="text-[#e5c07b]" /> : <Folder size={14} className="text-[#e5c07b]" /> : <File size={14} className="text-faint" />}
      <span className="min-w-0 flex-1 truncate">{e.name}</span>
      <span className="hidden items-center group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
        {e.dir && (
          <>
            <button className="icon-btn !h-5 !w-5" title="New File…" onClick={() => startCreate("file")}>
              <FilePlus size={13} />
            </button>
            <button className="icon-btn !h-5 !w-5" title="New Folder…" onClick={() => startCreate("folder")}>
              <FolderPlus size={13} />
            </button>
          </>
        )}
        <button className="icon-btn !h-5 !w-5" title="Rename…" onClick={() => x.setPending({ kind: "rename", path: e.path, dir: e.dir })}>
          <Pencil size={12} />
        </button>
        <button
          className="icon-btn !h-5 !w-5"
          title="Delete"
          onClick={async () => {
            if (!(await confirmDialog({ title: `Delete ${e.dir ? "folder" : "file"} "${e.name}"?`, message: `${e.path}${e.dir ? " and all its contents" : ""} will be deleted. This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
            if (await x.run("delete", e.path)) x.reload(parentOf(e.path));
          }}
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function FileTree({ rel, depth }: { rel: string; depth: number }) {
  const x = useExplorer();
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = x.versions[rel] ?? 0;

  useEffect(() => {
    let cancelled = false;
    api<FsEntry[]>(`/api/files?projectId=${x.projectId}&path=${encodeURIComponent(rel)}`)
      .then((r) => {
        if (cancelled) return;
        setEntries(r);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [x.projectId, rel, version, x.global]);

  if (error) return <p className="px-3 text-[12px] text-err">{error}</p>;
  if (!entries) return null;
  const creating = x.pending && x.pending.kind !== "rename" && x.pending.parent === rel ? x.pending : null;
  return (
    <div>
      {creating && (
        <NameInput
          depth={depth}
          dir={creating.kind === "folder"}
          initial=""
          onCancel={() => x.setPending(null)}
          onSubmit={async (name) => {
            x.setPending(null);
            const path = join(rel, name);
            if (await x.run(creating.kind === "folder" ? "mkdir" : "create", path)) x.reload(rel);
          }}
        />
      )}
      {entries.map((e) => (
        <div key={e.path}>
          <EntryRow e={e} depth={depth} />
          {e.dir && x.open[e.path] && <FileTree rel={e.path} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

/** Project file explorer (sidebar) with create / rename / delete. */
export default function Explorer({ projectId }: { projectId: string }) {
  const { log, openTab } = useWorkbench();
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [global, setGlobal] = useState(0);
  const [open, setOpenMap] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);

  const reload = useCallback((dir: string) => setVersions((v) => ({ ...v, [dir]: (v[dir] ?? 0) + 1 })), []);
  const setOpen = useCallback((path: string, o: boolean) => setOpenMap((m) => ({ ...m, [path]: o })), []);

  const run = useCallback(
    async (op: "create" | "mkdir" | "rename" | "delete", path: string, to?: string) => {
      try {
        await api("/api/files", { method: "POST", json: { projectId, op, path, to } });
        if (op === "create") openTab({ kind: "file", projectId, path }, path.split("/").pop() ?? path);
        if (op === "rename" || op === "delete") {
          // Close editor tabs for the moved/deleted path (and anything under it); reopen a renamed file.
          const { tabs, closeTab } = useWorkbench.getState();
          const prefix = `file:${projectId}:${path}`;
          const affected = tabs.filter((t) => t.id === prefix || t.id.startsWith(`${prefix}/`));
          affected.forEach((t) => closeTab(t.id));
          if (op === "rename" && to && affected.some((t) => t.id === prefix)) openTab({ kind: "file", projectId, path: to }, to.split("/").pop() ?? to);
        }
        return true;
      } catch (e) {
        log("error", "explorer", e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [projectId, log, openTab],
  );

  return (
    <Ctx.Provider value={{ projectId, versions, global, open, setOpen, pending, setPending, reload, run }}>
      <div className="group/explorer">
        <div className="flex h-[22px] items-center justify-end gap-0.5 px-2">
          <button className="icon-btn !h-5 !w-5" title="New File…" onClick={() => setPending({ kind: "file", parent: "" })}>
            <FilePlus size={13} />
          </button>
          <button className="icon-btn !h-5 !w-5" title="New Folder…" onClick={() => setPending({ kind: "folder", parent: "" })}>
            <FolderPlus size={13} />
          </button>
          <button className="icon-btn !h-5 !w-5" title="Refresh Explorer" onClick={() => setGlobal((g) => g + 1)}>
            <RefreshCw size={12} />
          </button>
        </div>
        <FileTree rel="" depth={0} />
      </div>
    </Ctx.Provider>
  );
}

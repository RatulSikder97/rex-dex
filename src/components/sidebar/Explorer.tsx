"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, File, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";

interface FsEntry { name: string; path: string; dir: boolean }

/** Inline editor row state: creating inside `parent`, or renaming `path`. */
type Pending = { kind: "file" | "folder"; parent: string } | { kind: "rename"; path: string; dir: boolean };

/** Rows rendered per directory before a "Show more" row (huge folders stay fast). */
const PAGE = 200;

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
  selected: string | null;
  select: (path: string | null) => void;
  remove: (e: FsEntry) => Promise<void>;
}

const Ctx = createContext<ExplorerCtx | null>(null);
const useExplorer = () => useContext(Ctx)!;

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
/** Left padding of a tree row at `depth` (twistie column included). */
const indent = (depth: number) => 8 + depth * 12;

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
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: indent(depth) }}>
      <span className="w-4 shrink-0" />
      {dir ? <Folder size={14} className="shrink-0 text-muted" aria-hidden /> : <File size={14} className="shrink-0 text-faint" aria-hidden />}
      <input
        ref={ref}
        className="input !h-[20px] !px-1 !text-[13px]"
        aria-label={initial ? `Rename ${initial}` : dir ? "New folder name" : "New file name"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" tabIndex={-1} className="icon-btn !h-5 !w-5" title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

function EntryRow({ e, depth, setSize, posInSet }: { e: FsEntry; depth: number; setSize: number; posInSet: number }) {
  const x = useExplorer();
  const { openTab } = useWorkbench();
  const isOpen = !!x.open[e.path];
  const selected = x.selected === e.path;
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
  const activate = () => {
    x.select(e.path);
    if (e.dir) x.setOpen(e.path, !isOpen);
    else openTab({ kind: "file", projectId: x.projectId, path: e.path }, e.name);
  };

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={e.dir ? isOpen : undefined}
      aria-selected={selected}
      data-path={e.path}
      data-dir={e.dir || undefined}
      tabIndex={selected ? 0 : -1}
      className={`side-row group flex h-[22px] items-center gap-1 pr-1 text-[13px] outline-none ${selected ? "bg-active" : "hover:bg-hover"}`}
      style={{ paddingLeft: indent(depth) }}
      title={e.path}
      onFocus={() => !selected && x.select(e.path)}
      onClick={activate}
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        if (ev.key === "Enter" || ev.key === " ") (ev.preventDefault(), activate());
        else if (ev.key === "F2") (ev.preventDefault(), x.setPending({ kind: "rename", path: e.path, dir: e.dir }));
        else if (ev.key === "Delete" || (ev.key === "Backspace" && (ev.metaKey || ev.ctrlKey))) (ev.preventDefault(), void x.remove(e));
      }}
    >
      <span className="flex w-4 shrink-0 justify-center text-faint" aria-hidden>
        {e.dir ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
      </span>
      {e.dir ? (
        isOpen ? <FolderOpen size={14} className="shrink-0 text-muted" aria-hidden /> : <Folder size={14} className="shrink-0 text-muted" aria-hidden />
      ) : (
        <File size={14} className="shrink-0 text-faint" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{e.name}</span>
      <span className="hidden items-center group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
        {e.dir && (
          <>
            <RowAction label="New file…" onClick={() => startCreate("file")}>
              <FilePlus size={13} />
            </RowAction>
            <RowAction label="New folder…" onClick={() => startCreate("folder")}>
              <FolderPlus size={13} />
            </RowAction>
          </>
        )}
        <RowAction label="Rename… (F2)" onClick={() => x.setPending({ kind: "rename", path: e.path, dir: e.dir })}>
          <Pencil size={12} />
        </RowAction>
        <RowAction label="Delete (Del)" onClick={() => void x.remove(e)}>
          <Trash2 size={12} />
        </RowAction>
      </span>
    </div>
  );
}

function FileTree({ rel, depth }: { rel: string; depth: number }) {
  const x = useExplorer();
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [retry, setRetry] = useState(0);
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
  }, [x.projectId, rel, version, x.global, retry]);

  if (error)
    return (
      <div role="alert" className="flex h-[22px] items-center gap-1.5 pr-2 text-[12px]" style={{ paddingLeft: indent(depth) + 20 }}>
        <span className="min-w-0 flex-1 truncate text-err" title={error}>
          Couldn’t read this folder: {error}
        </span>
        <button type="button" className="icon-btn !h-5 !w-5" title="Retry" aria-label="Retry" onClick={() => setRetry((n) => n + 1)}>
          <RotateCw size={12} />
        </button>
      </div>
    );
  if (!entries)
    return depth === 0 ? (
      <div aria-busy="true" aria-label="Loading files" className="space-y-[8px] py-1.5 pr-4" style={{ paddingLeft: indent(0) + 20 }}>
        {[70, 55, 62, 48, 66].map((w, i) => (
          <div key={i} className="skeleton h-[14px]" style={{ width: `${w}%` }} />
        ))}
      </div>
    ) : null;
  const creating = x.pending && x.pending.kind !== "rename" && x.pending.parent === rel ? x.pending : null;
  const shown = entries.slice(0, limit);
  const more = entries.length - shown.length;
  return (
    <div role={depth === 0 ? undefined : "group"}>
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
      {shown.map((e, i) => (
        <div key={e.path} role="none">
          <EntryRow e={e} depth={depth} setSize={entries.length} posInSet={i + 1} />
          {e.dir && x.open[e.path] && <FileTree rel={e.path} depth={depth + 1} />}
        </div>
      ))}
      {more > 0 && (
        <button
          type="button"
          className="side-row flex h-[22px] w-full items-center text-left text-[12px] text-accent hover:bg-hover"
          style={{ paddingLeft: indent(depth) + 20 }}
          onClick={() => setLimit((l) => l + PAGE)}
        >
          Show {Math.min(more, PAGE)} more of {more.toLocaleString()}
        </button>
      )}
      {depth === 0 && !entries.length && !creating && <p className="py-2 pl-5 pr-3 text-[12px] text-muted">This folder is empty.</p>}
    </div>
  );
}

/** Project file explorer (sidebar): a VS Code-style tree with create / rename / delete and keyboard navigation. */
export default function Explorer({ projectId, title = "Files", rootPath }: { projectId: string; title?: string; rootPath?: string | null }) {
  const { log, openTab } = useWorkbench();
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [global, setGlobal] = useState(0);
  const [open, setOpenMap] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const tree = useRef<HTMLDivElement>(null);

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

  const remove = useCallback(
    async (e: FsEntry) => {
      if (!(await confirmDialog({ title: `Delete ${e.dir ? "folder" : "file"} “${e.name}”?`, message: `${e.path}${e.dir ? " and everything in it" : ""} will be deleted. This can’t be undone.`, confirmLabel: "Delete", danger: true }))) return;
      if (await run("delete", e.path)) {
        reload(parentOf(e.path));
        setSelected((s) => (s === e.path ? null : s));
      }
    },
    [run, reload],
  );

  /** New file/folder goes into the selected folder (or the selected file's folder), like VS Code. */
  const createHere = (kind: "file" | "folder") => {
    setExpanded(true);
    const el = selected ? tree.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`) : null;
    const parent = !selected || !el ? "" : el.dataset.dir ? selected : parentOf(selected);
    if (parent) setOpen(parent, true);
    setPending({ kind, parent });
  };

  /** ↑/↓/Home/End move between visible rows; →/← expand, collapse or jump to the parent. */
  const onTreeKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    if (!rows.length) return;
    const cur = rows.findIndex((r) => r === document.activeElement);
    const focusAt = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      setSelected(r.dataset.path ?? null);
      r.focus();
    };
    const row = rows[cur];
    const path = row?.dataset.path ?? "";
    if (ev.key === "ArrowDown") (ev.preventDefault(), focusAt(cur + 1));
    else if (ev.key === "ArrowUp") (ev.preventDefault(), focusAt(cur < 0 ? 0 : cur - 1));
    else if (ev.key === "Home") (ev.preventDefault(), focusAt(0));
    else if (ev.key === "End") (ev.preventDefault(), focusAt(rows.length - 1));
    else if (ev.key === "ArrowRight" && row?.dataset.dir) {
      ev.preventDefault();
      if (!open[path]) setOpen(path, true);
      else focusAt(cur + 1);
    } else if (ev.key === "ArrowLeft" && row) {
      ev.preventDefault();
      if (row.dataset.dir && open[path]) setOpen(path, false);
      else {
        const parent = parentOf(path);
        const pi = rows.findIndex((r) => r.dataset.path === parent);
        if (parent && pi >= 0) focusAt(pi);
      }
    }
  };

  const section = `explorer-${projectId}`;

  return (
    <Ctx.Provider value={{ projectId, versions, global, open, setOpen, pending, setPending, reload, run, selected, select: setSelected, remove }}>
      <div className="group/explorer">
        <div className="group flex h-[22px] items-center pr-1 hover:bg-hover focus-within:bg-hover">
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-0.5 pl-1 text-left outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]"
            aria-expanded={expanded}
            aria-controls={section}
            title={rootPath ?? title}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="flex w-4 shrink-0 justify-center text-muted" aria-hidden>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="section-title truncate !text-fg">{title}</span>
          </button>
          <span className="hidden items-center gap-px group-focus-within:flex group-hover:flex">
            <button type="button" className="icon-btn !h-5 !w-5" title="New file…" aria-label="New file" onClick={() => createHere("file")}>
              <FilePlus size={13} />
            </button>
            <button type="button" className="icon-btn !h-5 !w-5" title="New folder…" aria-label="New folder" onClick={() => createHere("folder")}>
              <FolderPlus size={13} />
            </button>
            <button type="button" className="icon-btn !h-5 !w-5" title="Refresh explorer" aria-label="Refresh explorer" onClick={() => setGlobal((g) => g + 1)}>
              <RefreshCw size={12} />
            </button>
            <button type="button" className="icon-btn !h-5 !w-5" title="Collapse folders" aria-label="Collapse folders" onClick={() => setOpenMap({})}>
              <ChevronsDownUp size={13} />
            </button>
          </span>
        </div>
        {expanded && (
          <div
            ref={tree}
            id={section}
            role="tree"
            aria-label={`Files in ${title}`}
            tabIndex={selected ? -1 : 0}
            className="pb-2 outline-none"
            onKeyDown={onTreeKey}
            onFocus={(ev) => {
              // Tabbing into the tree with nothing selected lands on the first row.
              if (ev.target !== ev.currentTarget) return;
              const first = tree.current?.querySelector<HTMLElement>('[role="treeitem"]');
              if (first) {
                setSelected(first.dataset.path ?? null);
                first.focus();
              }
            }}
          >
            <FileTree rel="" depth={0} />
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

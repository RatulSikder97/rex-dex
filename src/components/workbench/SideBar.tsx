"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  FileCode2,
  FileJson,
  LayoutPanelLeft,
  Save,
  Sparkles,
  SquareTerminal,
  Clapperboard,
  Film,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Globe,
  History,
  Image as ImageIcon,
  Keyboard,
  Layers,
  Library,
  Music,
  Palette,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  SquareKanban,
  Trash2,
  Upload,
} from "lucide-react";
import { api, bytes, timeAgo } from "@/lib/client";
import type { Deliverable, Run } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/kit";
import { confirmDialog } from "@/components/ui/dialog";
import { useActiveProject, useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { activityLabel } from "./ActivityBar";
import { withShortcut } from "./shortcuts";
import { newProjectFlow, openFolderFlow, openProjectSettings, openSettingsJson, switchProject } from "./actions";
import { SETTINGS_TOC, sentenceCase } from "@/components/views/SettingsView";
import Explorer from "@/components/sidebar/Explorer";
import SearchPanel from "@/components/sidebar/SearchPanel";
import ScmPanel from "@/components/sidebar/ScmPanel";
import CreatePanel from "@/components/sidebar/CreatePanel";
import ExtensionsPanel from "@/components/sidebar/ExtensionsPanel";

/** Activities whose content is scoped to the current project (header shows its name). */
const PROJECT_SCOPED = new Set(["plan", "search", "scm", "library", "seo", "graphics"]);

export default function SideBar() {
  const activity = useWorkbench((s) => s.activity);
  const project = useActiveProject();
  return (
    <aside data-region="sidebar" tabIndex={-1} aria-label={`${activityLabel(activity)} sidebar`} className="flex h-full w-full flex-col bg-side outline-none">
      <div className="flex h-[35px] shrink-0 items-center gap-2 pl-5 pr-3">
        <h2 className="section-title truncate">{activityLabel(activity)}</h2>
        {PROJECT_SCOPED.has(activity) && project && (
          <span className="ml-auto truncate text-[11px] text-faint" title={`Current project: ${project.name} (switch in the title bar)`}>
            {project.name}
          </span>
        )}
      </div>
      <div data-sidebar-body className="min-h-0 flex-1 overflow-y-auto">
        {activity === "command" && <ProjectsSection />}
        {activity === "plan" && <PlanSection />}
        {activity === "code" && <CodeSection />}
        {activity === "search" && <SearchPanel />}
        {activity === "scm" && <ScmPanel />}
        {activity === "create" && <CreatePanel />}
        {activity === "extensions" && <ExtensionsPanel />}
        {activity === "library" && <LibrarySection />}
        {activity === "seo" && <SeoSection />}
        {activity === "graphics" && <GraphicsSection />}
        {activity === "video" && <MediaSection />}
        {activity === "runs" && <RunsSection />}
        {activity === "settings" && <SettingsSection />}
      </div>
    </aside>
  );
}

function Row({ active, onClick, children, actions, title }: { active?: boolean; onClick?: () => void; children: React.ReactNode; actions?: React.ReactNode; title?: string }) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onClick?.())}
      aria-current={active || undefined}
      className={`side-row group flex h-[22px] items-center gap-2 pl-5 pr-2 text-[13px] outline-none ${active ? "bg-active text-fg" : "text-fg hover:bg-hover"}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions && (
        <div className="hidden items-center group-focus-within:flex group-hover:flex [&_.icon-btn]:h-5 [&_.icon-btn]:w-5" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

function SubHeader({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex h-[22px] items-center justify-between pl-5 pr-2">
      <h3 className="section-title truncate">{children}</h3>
      <div className="flex items-center">{actions}</div>
    </div>
  );
}

const NoProject = () => (
  <EmptyState compact icon={FolderPlus} title="No project selected" hint="Create a project or open a folder to get started." action={{ label: "New project", icon: Plus, onClick: () => void newProjectFlow() }} secondary={{ label: "Open folder", onClick: () => void openFolderFlow() }} />
);

// ---------------------------------------------------------------- projects
function ProjectsSection() {
  const { projects, projectId, openTab, projectsLoaded } = useWorkbench();
  return (
    <div className="pb-3">
      <SubHeader
        actions={
          <>
            <button className="icon-btn" title="Open folder as project…" aria-label="Open folder as project" onClick={() => void openFolderFlow()}>
              <FolderOpen size={14} />
            </button>
            <button className="icon-btn" title={withShortcut("New project…", "newProject")} aria-label="New project" onClick={() => void newProjectFlow()}>
              <Plus size={14} />
            </button>
          </>
        }
      >
        Projects
      </SubHeader>
      {projects.map((p) => (
        <Row
          key={p.id}
          active={p.id === projectId}
          onClick={() => switchProject(p.id)}
          actions={
            <button className="icon-btn" title="Project settings" aria-label={`${p.name} settings`} onClick={() => openProjectSettings(p.id)}>
              <Settings2 size={13} />
            </button>
          }
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageColor(p.stage) }} />
          <span className="truncate">{p.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-faint">{p.stage}</span>
        </Row>
      ))}
      {projectsLoaded && !projects.length && (
        <EmptyState
          compact
          icon={FolderPlus}
          title="No projects yet"
          hint="A project is a product you run: its board, repo, deliverables, and agents."
          action={{ label: "New project", icon: Plus, onClick: () => void newProjectFlow() }}
          secondary={{ label: "Open folder", onClick: () => void openFolderFlow() }}
        />
      )}
      <div className="mt-3 px-3">
        <button className="btn w-full justify-center" onClick={() => openTab({ kind: "dashboard" }, "Command Center")}>
          Open command center
        </button>
      </div>
    </div>
  );
}

export function stageColor(stage: string): string {
  // Theme tokens, so every color theme recolors the stage dots.
  return (
    { idea: "var(--fg-faint)", planning: "var(--accent)", building: "var(--warn)", testing: "color-mix(in srgb, var(--accent) 55%, var(--ok))", launched: "var(--ok)", growing: "color-mix(in srgb, var(--accent) 50%, var(--err))" }[stage] ??
    "var(--fg-faint)"
  );
}

// ---------------------------------------------------------------- plan
function PlanSection() {
  const project = useActiveProject();
  const { openTab } = useWorkbench();
  if (!project) return <NoProject />;
  return (
    <div className="space-y-2 px-5 pb-3">
      <button className="btn btn-primary w-full justify-center" onClick={() => openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)}>
        <SquareKanban size={13} /> Open board
      </button>
      <button className="btn w-full justify-center" onClick={() => openProjectSettings(project.id)}>
        Project settings
      </button>
      <p className="pt-2 text-[12px] leading-relaxed text-muted">
        Use <b>Generate plan</b> on the board to turn a goal into tasks across every department, then <b>Delegate</b> each task to its AI department.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- code explorer
function CodeSection() {
  const project = useActiveProject();
  if (!project) return <NoProject />;
  return (
    <div className="pb-3">
      {project.repo_path ? (
        <>
          <Explorer projectId={project.id} title={project.name} rootPath={project.repo_path} />
        </>
      ) : (
        <EmptyState compact icon={FolderGit2} title="No repository linked" hint="Link a local folder so you can browse files and agents can edit code." action={{ label: "Link a repo folder", onClick: () => openProjectSettings(project.id) }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- deliverables
function useDeliverables(filter?: (d: Deliverable) => boolean) {
  const { projectId, version } = useWorkbench();
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    api<Deliverable[]>(`/api/deliverables${projectId ? `?projectId=${projectId}` : ""}`)
      .then((all) => setItems(filterRef.current ? all.filter(filterRef.current) : all))
      .catch(() => setItems([]));
  }, [projectId, version]);
  return items;
}

async function deleteDeliverable(d: Deliverable) {
  if (!(await confirmDialog({ title: `Delete "${d.title}"?`, message: "This deliverable will be removed permanently.", confirmLabel: "Delete", danger: true }))) return;
  const s = useWorkbench.getState();
  try {
    await api(`/api/deliverables/${d.id}`, { method: "DELETE" });
    s.closeTab(`deliverable:${d.id}`);
    s.bump();
  } catch (e) {
    s.log("error", "deliverables", String(e));
  }
}

function DeliverableRows({ items, icon }: { items: Deliverable[]; icon?: React.ReactNode }) {
  const { getDepartment } = useDepartments();
  const { openTab } = useWorkbench();
  return (
    <>
      {items.map((d) => {
        const dept = getDepartment(d.department);
        return (
          <Row
            key={d.id}
            title={d.title}
            onClick={() => openTab({ kind: "deliverable", id: d.id }, d.title)}
            actions={
              <button className="icon-btn" title="Delete" aria-label={`Delete ${d.title}`} onClick={() => void deleteDeliverable(d)}>
                <Trash2 size={13} />
              </button>
            }
          >
            {icon ?? <DeptIcon name={dept.icon} color={dept.color} size={13} />}
            <span className="truncate">{d.title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-faint">{timeAgo(d.updated_at)}</span>
          </Row>
        );
      })}
    </>
  );
}

function LibrarySection() {
  const items = useDeliverables();
  const toggleAgent = useWorkbench((s) => s.toggleAgent);
  if (!items) return <LoadingRows rows={6} height={14} className="px-5 pt-1" />;
  if (!items.length) return <EmptyState compact icon={Library} title="Nothing saved yet" hint="Save agent output from the Agent panel and it shows up here." action={{ label: "Open agent panel", icon: Bot, onClick: () => toggleAgent(true) }} />;
  return (
    <div className="pb-3">
      <DeliverableRows items={items} />
    </div>
  );
}

function SeoSection() {
  const items = useDeliverables((d) => d.department === "seo");
  const { openTab, delegate } = useWorkbench();
  const project = useActiveProject();
  return (
    <div className="pb-3">
      <div className="space-y-2 px-5 pb-3">
        <button className="btn btn-primary w-full justify-center" onClick={() => openTab({ kind: "seo" }, "SEO & AEO")}>
          <Search size={13} /> New audit
        </button>
        <button
          className="btn w-full justify-center"
          onClick={() =>
            delegate({
              department: "seo",
              brief: project?.website_url ? `Build an SEO + AEO content plan for ${project.website_url}.` : "Build an SEO + AEO content plan for this project.",
            })
          }
        >
          <Bot size={13} /> Ask SEO agent
        </button>
      </div>
      <SubHeader>Saved audits and reports</SubHeader>
      {items === null ? (
        <LoadingRows rows={4} height={14} className="px-5 pt-1" />
      ) : items.length ? (
        <DeliverableRows items={items} icon={<Globe size={13} className="text-faint" />} />
      ) : (
        <p className="px-5 text-[12px] leading-relaxed text-muted">Run an audit and save it as a report. It shows up here.</p>
      )}
    </div>
  );
}

function GraphicsSection() {
  const items = useDeliverables((d) => d.kind === "svg" || d.department === "design");
  const { openTab } = useWorkbench();
  return (
    <div className="pb-3">
      <div className="px-5 pb-3">
        <button className="btn btn-primary w-full justify-center" onClick={() => openTab({ kind: "graphics" }, "Graphics Studio")}>
          <Palette size={13} /> New graphic
        </button>
      </div>
      <SubHeader>Saved graphics</SubHeader>
      {items === null ? (
        <LoadingRows rows={4} height={14} className="px-5 pt-1" />
      ) : items.length ? (
        <DeliverableRows items={items} icon={<ImageIcon size={13} className="text-faint" />} />
      ) : (
        <p className="px-5 text-[12px] leading-relaxed text-muted">OG images, logos, and ads you save from Graphics Studio show up here.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
const SETTINGS_ICONS: Record<string, typeof Bot> = {
  Workbench: LayoutPanelLeft,
  Appearance: Palette,
  Editor: FileCode2,
  Files: Save,
  Terminal: SquareTerminal,
  Agents: Bot,
  Departments: Layers,
  Features: Sparkles,
  "Extension marketplaces": Puzzle,
  "Keyboard Shortcuts": Keyboard,
  "Keyboard shortcuts": Keyboard,
};
const SETTINGS_SECTIONS: { id: string; label: string; icon: typeof Bot }[] = SETTINGS_TOC.map((t) => ({ ...t, label: sentenceCase(t.label), icon: SETTINGS_ICONS[t.label] ?? SETTINGS_ICONS[sentenceCase(t.label)] ?? Settings2 }));

function SettingsSection() {
  const openSettings = useWorkbench((s) => s.openSettings);
  const [current, setCurrent] = useState<string | null>(null);
  return (
    <nav aria-label="Settings sections" className="pb-3">
      {SETTINGS_SECTIONS.map((s) => (
        <Row
          key={s.id}
          active={current === s.id}
          onClick={() => {
            setCurrent(s.id);
            openSettings(s.id);
          }}
        >
          <s.icon size={14} className="text-faint" />
          <span className="truncate">{s.label}</span>
        </Row>
      ))}
      <div className="mx-5 my-2 h-px bg-line" role="separator" />
      <Row onClick={openSettingsJson} title="Edit user settings as JSON">
        <FileJson size={14} className="text-faint" />
        <span className="truncate">Open settings (JSON)</span>
      </Row>
    </nav>
  );
}

// ---------------------------------------------------------------- media
interface MediaFile { name: string; size: number; modified: number; kind: "video" | "audio" | "image" }

function MediaSection() {
  const { openTab, version, bump, log } = useWorkbench();
  const [items, setItems] = useState<MediaFile[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<MediaFile[]>("/api/media").then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    load();
  }, [load, version]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    try {
      const res = await api<{ saved: string[] }>("/api/media", { method: "POST", body: fd });
      log("ok", "media", `Uploaded ${res.saved.join(", ")}`);
      bump();
      if (res.saved[0]) openTab({ kind: "video", file: res.saved[0] }, "Video Studio");
    } catch (e) {
      log("error", "media", String(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (m: MediaFile) => {
    if (!(await confirmDialog({ title: `Delete ${m.name}?`, message: "The media file is removed from disk.", confirmLabel: "Delete", danger: true }))) return;
    await api(`/api/media/${encodeURIComponent(m.name)}`, { method: "DELETE" }).catch((e) => log("error", "media", String(e)));
    bump();
  };

  return (
    <div className="pb-3">
      <div className="flex items-center gap-2 pb-2 pl-5 pr-3">
        <button className="btn btn-primary flex-1 justify-center" onClick={() => input.current?.click()} disabled={uploading}>
          <Upload size={13} /> {uploading ? "Uploading…" : "Import media"}
        </button>
        <button className="icon-btn" title="Refresh media" aria-label="Refresh media" onClick={load}>
          <RefreshCw size={13} />
        </button>
        <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => upload(e.target.files)} />
      </div>
      {items?.map((m) => (
        <Row
          key={m.name}
          title={m.name}
          onClick={() => openTab({ kind: "video", file: m.name }, "Video Studio")}
          actions={
            <button className="icon-btn" title="Delete file" aria-label={`Delete ${m.name}`} onClick={() => void remove(m)}>
              <Trash2 size={13} />
            </button>
          }
        >
          {m.kind === "video" ? <Film size={13} className="text-faint" /> : m.kind === "audio" ? <Music size={13} className="text-faint" /> : <ImageIcon size={13} className="text-faint" />}
          <span className="truncate">{m.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-faint">{bytes(m.size)}</span>
        </Row>
      ))}
      {items && !items.length && <EmptyState compact icon={Clapperboard} title="No media yet" hint="Import a video, audio, or image file to start editing." />}
    </div>
  );
}

// ---------------------------------------------------------------- runs
function RunsSection() {
  const { getDepartment } = useDepartments();
  const { label } = useAgents();
  const { openTab, version, toggleAgent } = useWorkbench();
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    const load = () => api<Run[]>("/api/runs?limit=100").then(setRuns).catch(() => setRuns((r) => r ?? []));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [version]);
  if (!runs) return <LoadingRows rows={8} height={14} className="px-5 pt-1" />;
  if (!runs.length) return <EmptyState compact icon={History} title="No agent runs yet" hint="Delegate a task from the board or ask a department in the Agent panel." action={{ label: "Open agent panel", icon: Bot, onClick: () => toggleAgent(true) }} />;
  return (
    <div className="pb-3">
      {runs.map((r) => {
        const dept = getDepartment(r.department);
        return (
          <Row key={r.id} title={`${r.brief}\n${dept.name} · ${label(r.provider)} · ${r.status}`} onClick={() => openTab({ kind: "run", id: r.id }, `Run · ${dept.name}`)}>
            <span aria-label={r.status} className={`h-2 w-2 shrink-0 rounded-full ${r.status === "running" ? "bg-accent" : r.status === "done" ? "bg-ok" : r.status === "error" ? "bg-err" : "bg-faint"}`} />
            <DeptIcon name={dept.icon} color={dept.color} size={13} />
            <span className="truncate">{r.brief}</span>
            <span className="ml-auto shrink-0 text-[11px] text-faint">{timeAgo(r.created_at)}</span>
          </Row>
        );
      })}
    </div>
  );
}


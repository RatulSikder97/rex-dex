"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Code2, FolderCog, FolderOpen, Palette, LayoutPanelLeft, PanelBottom, PanelLeft, PanelRight, Plus, Search } from "lucide-react";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { stageColor } from "./SideBar";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { newProjectFlow, openFolderFlow, openProjectSettings, switchProject } from "./actions";
import { isMac, kbd, shortcut, withShortcut } from "./shortcuts";
import MenuBar, { menuBarWidth } from "./MenuBar";
import { desktop } from "@/lib/desktop";

/**
 * Desktop app (Electron) title bar: the whole bar drags the window, controls stay
 * clickable; macOS leaves room for the traffic lights (none in full screen),
 * Windows/Linux for the native caption-button overlay on the right.
 */
const DESKTOP_TITLEBAR_CSS = `
.titlebar[data-desktop]{-webkit-app-region:drag}
.titlebar[data-desktop] :is(button,a,input,select,[role=menubar],[role=radiogroup],[role=menu]){-webkit-app-region:no-drag}
.titlebar[data-desktop=darwin]{padding-left:78px}
html[data-rex-fullscreen] .titlebar[data-desktop=darwin]{padding-left:8px}
.titlebar[data-desktop=win32],.titlebar[data-desktop=linux]{padding-right:146px}
`;

/** Opens the global project switcher anchored under the title-bar button (also used by the status bar). */
export const openProjectSwitcher = (at?: { x: number; y: number }) => window.dispatchEvent(new CustomEvent("rex:project-switcher", { detail: at }));

export function useProjectMenu(): MenuItem[] {
  const projects = useWorkbench((s) => s.projects);
  const projectId = useWorkbench((s) => s.projectId);
  return [
    { type: "header", label: projects.length ? "Switch project" : "No projects yet" },
    ...projects.map<MenuItem>((p) => ({ label: p.name, lead: <ProjectAvatar project={p} size={16} />, hint: p.stage, checked: p.id === projectId, onSelect: () => switchProject(p.id) })),
    { type: "separator" },
    { label: "New project…", icon: Plus, hint: shortcut("newProject"), onSelect: () => void newProjectFlow() },
    { label: "Open folder as project…", icon: FolderOpen, onSelect: () => void openFolderFlow() },
    { label: "Project settings…", icon: FolderCog, disabled: !projectId, onSelect: () => openProjectSettings() },
    { label: "Project logo…", icon: Palette, disabled: !projectId, onSelect: () => openLogoStudio(projectId) },
  ];
}

export default function TitleBar() {
  const project = useActiveProject();
  const { sidebarOpen, panelOpen, agentOpen, toggleSidebar, togglePanel, toggleAgent, setPalette, runningRuns } = useWorkbench();
  const layoutMode = useWorkbench((s) => s.layoutMode);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useProjectMenu();
  const header = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const mac = isMac();
  const desk = desktop();

  // Collapse the menu bar into a hamburger when the title bar can't fit it next to the switcher + search.
  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () => setCollapsed(el.clientWidth < menuBarWidth() + 40 + 190 + 300 + 100);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const openMenu = () => {
    const r = btn.current?.getBoundingClientRect();
    setMenu(r ? { x: r.left, y: r.bottom + 4 } : { x: 60, y: 34 });
  };

  // The status-bar project item opens the same menu, anchored where it was clicked.
  useEffect(() => {
    const on = (e: Event) => {
      const at = (e as CustomEvent<{ x: number; y: number } | undefined>).detail;
      if (at) setMenu(at);
      else openMenu();
    };
    window.addEventListener("rex:project-switcher", on);
    return () => window.removeEventListener("rex:project-switcher", on);
  });

  const toggle = (on: boolean, Icon: typeof PanelLeft, label: string, id: string, run: () => void, badge?: number) => (
    <button
      className={`icon-btn relative bg-transparent hover:bg-hover ${on ? "text-fg" : "text-faint"}`}
      aria-pressed={on}
      aria-label={label}
      title={withShortcut(label, id)}
      onClick={run}
    >
      <Icon size={15} strokeWidth={1.7} className={on ? "text-accent" : ""} />
      {!!badge && <span className="badge absolute -right-1 -top-1">{badge}</span>}
    </button>
  );

  return (
    <header
      ref={header}
      data-desktop={desk?.platform}
      className="titlebar flex h-[34px] shrink-0 items-center gap-2 border-b border-line bg-title px-2"
      onDoubleClick={(e) => e.target === e.currentTarget && setPalette(true)}
    >
      {desk && <style>{DESKTOP_TITLEBAR_CSS}</style>}
      <div className="flex min-w-0 shrink items-center gap-1">
        {/* On macOS the "REX" application menu doubles as the logo. */}
        {(!mac || collapsed) && (
          <span className="select-none px-1.5 text-[12px] font-black tracking-tight text-accent" aria-hidden>
            REX
          </span>
        )}
        <MenuBar collapsed={collapsed} />
        {desk?.platform !== "darwin" && <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden />}
        <button
          ref={btn}
          className="flex h-[24px] min-w-0 max-w-[260px] items-center gap-1.5 rounded-[4px] px-1.5 text-[12.5px] hover:bg-hover aria-expanded:bg-hover"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label="Switch project"
          title={project ? `${project.name} · ${project.stage} (switch project)` : "Switch project"}
          onClick={() => (menu ? setMenu(null) : openMenu())}
        >
          {project && <ProjectAvatar project={project} size={17} />}
          <span className="truncate">{project ? project.name : "No project"}</span>
          {project && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: stageColor(project.stage) }} aria-hidden />}
          <ChevronDown size={13} className="text-faint" />
        </button>
      </div>

      <div className="flex min-w-[120px] flex-1 justify-center" onDoubleClick={(e) => e.target === e.currentTarget && setPalette(true)}>
      <button
        className="flex h-[24px] w-full min-w-0 max-w-[520px] items-center gap-2 rounded-[6px] border border-line bg-input px-2 text-[12px] text-muted hover:border-[color-mix(in_srgb,var(--fg-faint)_55%,var(--border))] hover:text-fg"
        onClick={() => setPalette(true, "commands")}
        aria-label="Search files, commands, agents"
        title={`Search files, commands, agents (${kbd("⌘K")})`}
      >
        <Search size={13} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">Search files, commands, agents…</span>
        <span className="kbd hidden shrink-0 sm:inline">{kbd("⌘K")}</span>
      </button>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-0.5">
        <LayoutModeToggle />
        {layoutMode === "code" && (
          <>
            {toggle(sidebarOpen, PanelLeft, "Toggle sidebar", "sidebar", toggleSidebar)}
            {toggle(panelOpen, PanelBottom, "Toggle bottom panel", "panel", () => togglePanel())}
            {toggle(agentOpen, PanelRight, "Toggle agent panel", "agent", () => toggleAgent(), runningRuns)}
          </>
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} label="Projects" minWidth={260} />}
    </header>
  );
}

/** "Mission | Code" segmented switch: Manus-style task workspace vs. the VS Code-style IDE (⌘⇧M toggles). */
function LayoutModeToggle() {
  const mode = useWorkbench((s) => s.layoutMode);
  const setMode = useWorkbench((s) => s.setLayoutMode);
  const opt = (m: "mission" | "code", Icon: typeof Code2, label: string, hint: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      tabIndex={mode === m ? 0 : -1}
      aria-label={`${label} mode`}
      title={`${hint} (${shortcut("layoutMode") || kbd("⌘⇧M")} toggles)`}
      className="!h-[18px] !px-1.5"
      onClick={() => setMode(m)}
    >
      <Icon size={13} strokeWidth={1.8} className={mode === m ? "text-accent" : ""} aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Layout mode"
      className="seg mr-1.5"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const group = e.currentTarget;
        setMode(mode === "mission" ? "code" : "mission");
        requestAnimationFrame(() => group.querySelector<HTMLElement>(`[aria-checked="true"]`)?.focus());
      }}
    >
      {opt("mission", LayoutPanelLeft, "Mission", "Mission mode: tasks, pipeline, output and issues")}
      {opt("code", Code2, "Code", "Code mode: the full IDE")}
    </div>
  );
}

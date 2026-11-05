"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Briefcase,
  Building2,
  Cable,
  ChevronDown,
  Cpu,
  Palette,
  Users,
  ChevronRight,
  Code2,
  Film,
  FolderCog,
  FolderOpen,
  ImageIcon,
  MessageSquareDashed,
  Network,
  Plus,
  Puzzle,
  Search,
  ServerCog,
  Settings,
  Sparkles,
  SquareKanban,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { timeAgo } from "@/lib/client";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { newProjectFlow, openFolderFlow, openProjectHub, openProjectSettings } from "@/components/workbench/actions";
import { shortcut } from "@/components/workbench/shortcuts";
import { useActiveProject, useDepartments, useWorkbench, type TabSpec } from "@/store/workbench";
import { briefTitle, useMissionData } from "./data";
import { EXTENSIONS_PAGE, openMissionPage, startConversation } from "./nav";
import { DeptIcon } from "@/components/icons";
import { DeptAvatar, StatusDot } from "./ui";

interface RailLink {
  label: string;
  icon: LucideIcon;
  /** Tab kind this link opens (for the active state), or the Extensions pseudo page. */
  kind: TabSpec["kind"] | typeof EXTENSIONS_PAGE | "code-mode";
  spec: (projectId: string | null) => TabSpec | "extensions" | "code-mode" | null;
  title: string;
  hint?: string;
}

type GroupId = "work" | "team" | "studios" | "company" | "system";

const WORK: RailLink[] = [
  { label: "Board", icon: SquareKanban, kind: "board", spec: (pid) => (pid ? { kind: "board", projectId: pid } : null), title: "Board" },
  { label: "Swarms", icon: Network, kind: "swarms", spec: (pid) => (pid ? { kind: "swarms" } : null), title: "Swarms" },
];
const GROUPS: { id: GroupId; label: string; icon: LucideIcon; links: RailLink[] }[] = [
  {
    id: "studios",
    label: "Studios",
    icon: Palette,
    links: [
      { label: "Create", icon: Sparkles, kind: "create", spec: () => ({ kind: "create" }), title: "Create Studio" },
      { label: "Graphics", icon: ImageIcon, kind: "graphics", spec: () => ({ kind: "graphics" }), title: "Graphics Studio" },
      { label: "Video", icon: Film, kind: "video", spec: () => ({ kind: "video" }), title: "Video Studio" },
      { label: "SEO & AEO", icon: Search, kind: "seo", spec: () => ({ kind: "seo" }), title: "SEO & AEO" },
    ],
  },
  {
    id: "company",
    label: "Company",
    icon: Building2,
    links: [
      { label: "Ops", icon: ServerCog, kind: "ops", spec: () => ({ kind: "ops" }), title: "Ops" },
      { label: "Connections", icon: Cable, kind: "connections", spec: () => ({ kind: "connections" }), title: "Connections" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Cpu,
    links: [
      { label: "Extensions", icon: Puzzle, kind: EXTENSIONS_PAGE, spec: () => "extensions", title: "Extensions", hint: shortcut("extensions") },
      { label: "Settings", icon: Settings, kind: "settings", spec: () => ({ kind: "settings" }), title: "Settings", hint: shortcut("settings") },
      { label: "Code mode", icon: Code2, kind: "code-mode", spec: () => "code-mode", title: "Switch to Code mode (IDE)", hint: shortcut("layoutMode") },
    ],
  },
];

const TASKS_CAP = 8;
const COLLAPSE_KEY = "rex-rail-collapsed";

function useCollapsed() {
  const [set, setSet] = useState<Set<GroupId>>(() => new Set());
  useEffect(() => {
    try {
      setSet(new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as GroupId[]));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = (id: GroupId) =>
    setSet((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return { collapsed: set, toggle };
}

/** Mission mode left rail: project + New task, then grouped navigation (Work, Team, Studios, Company, System). */
export default function LeftRail({ compact }: { compact: boolean }) {
  const project = useActiveProject();
  const projects = useWorkbench((s) => s.projects);
  const agentThread = useWorkbench((s) => s.agentThread);
  const missionPage = useWorkbench((s) => s.missionPage);
  const tabs = useWorkbench((s) => s.tabs);
  const { departments, getDepartment } = useDepartments();
  const { threads, loaded } = useMissionData();
  // Swarm step conversations live in their swarm, not in the task list.
  const listed = useMemo(() => threads.filter((t) => !t.thread_id.startsWith("swarm:")), [threads]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [allTasks, setAllTasks] = useState(false);
  const projectBtn = useRef<HTMLButtonElement>(null);
  const { collapsed, toggle } = useCollapsed();

  const runningByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (t.running) m.set(t.department, (m.get(t.department) ?? 0) + t.running);
    return m;
  }, [threads]);

  const pageKind = missionPage === EXTENSIONS_PAGE ? EXTENSIONS_PAGE : (tabs.find((t) => t.id === missionPage)?.spec.kind ?? null);

  const projectItems: MenuItem[] = [
    { type: "header", label: projects.length ? "Switch project" : "No projects yet" },
    ...projects.map<MenuItem>((p) => ({ label: p.name, hint: p.stage, checked: p.id === project?.id, onSelect: () => useWorkbench.getState().setProject(p.id) })),
    { type: "separator" },
    { label: "New project…", icon: Plus, hint: shortcut("newProject"), onSelect: () => void newProjectFlow() },
    { label: "Open folder as project…", icon: FolderOpen, onSelect: () => void openFolderFlow() },
    { label: "Project hub…", icon: FolderCog, disabled: !project, onSelect: () => openProjectSettings() },
    { label: project?.logo ? "Change logo…" : "Generate logo…", icon: Sparkles, disabled: !project, onSelect: () => openLogoStudio(project?.id) },
  ];

  const openLink = (l: RailLink) => {
    const spec = l.spec(project?.id ?? null);
    if (!spec) return;
    if (spec === "code-mode") return useWorkbench.getState().setLayoutMode("code");
    if (spec === "extensions") return openMissionPage(EXTENSIONS_PAGE);
    const title = spec.kind === "board" && project ? `${project.name} · Board` : l.title;
    useWorkbench.getState().openTab(spec, title);
    openMissionPage(useWorkbench.getState().activeTabId);
  };

  const selected = (threadId: string) => agentThread.threadId === threadId && !missionPage;
  const shownTasks = compact ? listed.slice(0, 6) : allTasks ? listed.slice(0, 60) : listed.slice(0, TASKS_CAP);

  // Arrow keys move between rail items (Home/End jump to the ends).
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-rail]:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  const linkRow = (l: RailLink) => {
    const disabled = !l.spec(project?.id ?? null);
    const on = pageKind === l.kind;
    return (
      <li key={l.label}>
        <button
          data-rail
          disabled={disabled}
          aria-current={on ? "page" : undefined}
          className={`group/link flex min-w-0 items-center gap-1.5 text-[13px] outline-offset-[-1px] disabled:opacity-40 disabled:hover:bg-transparent ${compact ? "mx-auto h-8 w-8 justify-center rounded-md" : "h-[22px] w-full pl-[26px] pr-3"} ${
            on ? "bg-active text-fg" : "text-fg/85 hover:bg-hover"
          }`}
          title={l.hint ? `${l.title} (${l.hint})` : l.title}
          aria-label={l.title}
          onClick={() => openLink(l)}
        >
          <l.icon size={14} strokeWidth={1.75} className={`shrink-0 ${on ? "text-fg" : "text-muted"}`} />
          {!compact && <span className="min-w-0 flex-1 truncate text-left">{l.label}</span>}
          {!compact && l.hint && <span className="hidden shrink-0 text-[11px] text-faint group-hover/link:inline group-focus-visible/link:inline">{l.hint}</span>}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Mission navigation" className="group/rail no-x-scroll flex h-full min-h-0 w-full min-w-0 flex-col bg-side" onKeyDown={onKey}>
      {/* project + primary action */}
      <div className={`flex flex-col gap-1.5 ${compact ? "items-center px-2 pt-2.5" : "px-2 pt-2.5"}`}>
        <div className={compact ? "contents" : "flex min-w-0 items-center gap-0.5"}>
        {!compact && project && (
          <button
            data-rail
            className="group/logo relative shrink-0 rounded-[6px]"
            onClick={() => openLogoStudio(project.id)}
            title={project.logo ? "Change project logo" : "Generate a project logo"}
            aria-label={project.logo ? "Change project logo" : "Generate a project logo"}
          >
            <ProjectAvatar project={project} size={22} />
            <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-[color-mix(in_srgb,var(--bg-side)_70%,transparent)] text-accent opacity-0 transition-opacity group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100" aria-hidden>
              <Sparkles size={11} />
            </span>
          </button>
        )}
        <button
          ref={projectBtn}
          data-rail
          className={`flex h-8 min-w-0 items-center gap-1.5 rounded-md hover:bg-hover ${compact ? "w-8 justify-center" : "min-w-0 flex-1 px-1.5"}`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label={`Project: ${project?.name ?? "none"}. Switch project`}
          title={project ? `${project.name} · ${project.stage} — switch project` : "Switch project"}
          onClick={() => {
            const r = projectBtn.current?.getBoundingClientRect();
            setMenu(menu ? null : r ? { x: r.left, y: r.bottom + 4 } : { x: 12, y: 90 });
          }}
        >
          {compact && <ProjectAvatar project={project} size={28} />}
          {!compact && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-semibold leading-tight text-fg">{project?.name ?? "No project"}</span>
              </span>
              {project && <span className="shrink-0 text-[11px] capitalize text-faint">{project.stage}</span>}
              <ChevronDown size={12} className="shrink-0 text-faint" />
            </>
          )}
        </button>
        {!compact && project && (
          <button data-rail className="icon-btn !h-7 !w-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/rail:opacity-100" title="Project hub: repository, servers, domains, deploy, connections" aria-label={`${project.name} project hub`} onClick={() => openProjectHub(project.id)}>
            <Settings size={14} strokeWidth={1.75} />
          </button>
        )}
        </div>
        <button
          data-rail
          className={`group/new flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-[4px] border border-line bg-elev text-[13px] text-fg hover:bg-hover ${compact ? "w-8 justify-center" : "w-full px-2"}`}
          onClick={() => startConversation("ceo")}
          title={`New task — starts with the Chief of Staff${shortcut("newConversation") ? ` (${shortcut("newConversation")})` : ""}`}
          aria-label="New task"
        >
          <SquarePen size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
          {!compact && <span className="flex-1 text-left">New task</span>}
          {!compact && <span className="truncate text-[11px] text-faint">{shortcut("newConversation") || "Chief of Staff"}</span>}
        </button>
      </div>

      <div className={`mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-clip border-t border-line pb-3 ${compact ? "space-y-3 pt-3" : ""}`}>
        {/* Work */}
        <Group id="work" label="Work" icon={Briefcase} compact={compact} collapsed={collapsed} toggle={toggle}>
          <ul className={compact ? "flex flex-col items-center gap-1" : "space-y-px"}>{WORK.map(linkRow)}</ul>
          {!compact && (
            <div className="mt-1 flex h-[22px] items-center pl-[26px] pr-3">
              <span className="text-[11px] text-faint">Recent tasks</span>
              {!!listed.length && <span className="ml-1.5 text-[10.5px] tabular-nums text-faint">{listed.length}</span>}
            </div>
          )}
          {loaded && !listed.length && !compact && (
            <button
              data-rail
              className="flex h-[22px] w-full items-center gap-1.5 pl-[26px] pr-3 text-left text-[12px] text-faint outline-offset-[-1px] hover:bg-hover hover:text-muted"
              onClick={() => startConversation("ceo")}
            >
              <MessageSquareDashed size={14} className="mt-0.5 shrink-0 text-faint" />
              <span>No tasks yet</span>
            </button>
          )}
          {!loaded && !compact && (
            <div className="space-y-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton mx-3 h-[18px] rounded-sm" />
              ))}
            </div>
          )}
          <ul className={compact ? "mt-1 flex flex-col items-center gap-1 border-t border-line pt-2" : "space-y-px"} aria-label="Tasks">
            {shownTasks.map((t) => {
              const d = getDepartment(t.department);
              const on = selected(t.thread_id);
              return (
                <li key={t.thread_id}>
                  <button
                    data-rail
                    className={`group flex w-full min-w-0 items-center gap-1.5 text-left outline-offset-[-1px] ${compact ? "h-8 w-8 justify-center rounded-md" : "h-[22px] pl-[26px] pr-3"} ${
                      on ? "bg-active text-fg" : "text-fg/85 hover:bg-hover"
                    }`}
                    aria-current={on ? "true" : undefined}
                    title={`${d.name}: ${briefTitle(t.title, 200)}`}
                    onClick={() => {
                      useWorkbench.getState().setMission({ missionPage: null });
                      useWorkbench.getState().openConversation({ department: t.department, threadId: t.thread_id });
                    }}
                  >
                    <span className="relative">
                      {compact ? <DeptAvatar dept={d} size={24} /> : <DeptIcon name={d.icon} color={d.color} size={14} />}
                      {!!t.running && (
                        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-side p-[2px]">
                          <StatusDot color="var(--accent)" live className="!h-[7px] !w-[7px]" />
                        </span>
                      )}
                    </span>
                    {!compact && (
                      <span className="min-w-0 flex-1 truncate text-[13px]">{briefTitle(t.title)}</span>
                    )}
                    {!compact && <span className={`shrink-0 text-[11px] tabular-nums ${t.running ? "font-medium text-accent" : "text-faint"}`}>{t.running ? "live" : shortAgo(t.updated_at)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {!compact && listed.length > TASKS_CAP && (
            <button data-rail className="flex h-[22px] w-full items-center gap-1.5 pl-[26px] pr-3 text-[12px] text-faint outline-offset-[-1px] hover:bg-hover hover:text-muted" onClick={() => setAllTasks((v) => !v)} aria-expanded={allTasks}>
              <ChevronDown size={12} className={`transition-transform ${allTasks ? "rotate-180" : ""}`} />
              {allTasks ? "Show fewer" : `Show all ${listed.length}`}
            </button>
          )}
        </Group>

        {/* Team: compact avatar grid — pick who answers a new task */}
        {/* In the icon-only rail the team lives on the Mission home roster instead. */}
        {!compact && (
        <Group id="team" label="Team" icon={Users} compact={compact} collapsed={collapsed} toggle={toggle} count={departments.length}>
          <ul className="space-y-px">
            {departments.map((d) => {
              const running = runningByDept.get(d.id) ?? 0;
              return (
                <li key={d.id}>
                  <button
                    data-rail
                    className="group/dept flex h-[22px] w-full min-w-0 items-center gap-1.5 pl-[26px] pr-3 text-left text-[13px] text-fg/85 outline-offset-[-1px] hover:bg-hover"
                    title={`New task for ${d.name} — ${d.role}${running ? ` (${running} running)` : ""}`}
                    aria-label={`New task for ${d.name}`}
                    onClick={() => startConversation(d.id)}
                  >
                    <DeptIcon name={d.icon} color={d.color} size={14} />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {running > 0 ? <StatusDot color="var(--ok)" live className="!h-[6px] !w-[6px]" /> : <Plus size={12} className="shrink-0 text-faint opacity-0 group-hover/dept:opacity-100" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Group>
        )}

        {GROUPS.map((g) => (
          <Group key={g.id} id={g.id} label={g.label} icon={g.icon} compact={compact} collapsed={collapsed} toggle={toggle}>
            <ul className={compact ? "flex flex-col items-center gap-1" : "space-y-px"}>{g.links.map(linkRow)}</ul>
          </Group>
        ))}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={projectItems} onClose={() => setMenu(null)} label="Projects" minWidth={240} />}
    </nav>
  );
}

/** "2h", "3d" — tight relative time for the task list. */
function shortAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return timeAgo(ts);
}

function Group({
  id,
  label,
  count,
  compact,
  collapsed,
  toggle,
  children,
}: {
  id: GroupId;
  label: string;
  icon?: LucideIcon;
  count?: number;
  compact: boolean;
  collapsed: Set<GroupId>;
  toggle: (id: GroupId) => void;
  children: ReactNode;
}) {
  if (compact)
    return (
      <div role="group" aria-label={label} className="border-t border-line px-2 pt-3 first:border-t-0 first:pt-0">
        {children}
      </div>
    );
  const closed = collapsed.has(id);
  // VS Code-style view section: full-width header bar, chevron left, bold uppercase title,
  // separator line above, actions/badge on the right; rows below are edge-to-edge.
  return (
    <div role="group" aria-label={label} className="border-t border-line first:border-t-0">
      <button
        data-rail
        className="group sticky top-0 z-[1] flex h-[22px] w-full items-center gap-0.5 bg-side pl-1.5 pr-3 text-left outline-offset-[-1px]"
        aria-expanded={!closed}
        aria-controls={`rail-${id}`}
        onClick={() => toggle(id)}
        title={label}
      >
        <ChevronRight size={16} strokeWidth={1.75} className={`shrink-0 text-muted ${closed ? "" : "rotate-90"}`} />
        <span className="section-title truncate">{label}</span>
        {count !== undefined && <span className="count ml-auto">{count}</span>}
      </button>
      {!closed && (
        <div id={`rail-${id}`} className="pb-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

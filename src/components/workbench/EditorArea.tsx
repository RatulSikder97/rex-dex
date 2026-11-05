"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, LayoutDashboard, X, XSquare } from "lucide-react";
import { useWorkbench, type Tab } from "@/store/workbench";
import { Menu } from "@/components/ui/menu";
import Dashboard from "@/components/views/Dashboard";
import Board from "@/components/views/Board";
import FileEditor from "@/components/views/FileEditor";
import DeliverableView from "@/components/views/DeliverableView";
import RunView from "@/components/views/RunView";
import SeoView from "@/components/views/SeoView";
import GraphicsView from "@/components/views/GraphicsView";
import VideoView from "@/components/views/VideoView";
import ProjectHub from "@/components/views/ProjectHub";
import SettingsView from "@/components/views/SettingsView";
import DiffView from "@/components/views/DiffView";
import CreateStudio from "@/components/views/CreateStudio";
import ConnectionsView from "@/components/views/ConnectionsView";
import OpsView from "@/components/views/OpsView";
import SwarmView from "@/components/swarm/SwarmView";
import SwarmsList from "@/components/swarm/SwarmsList";
import ExtensionDetail from "@/components/views/ExtensionDetail";
import Welcome from "@/components/views/Welcome";
import ShortcutsView from "@/components/views/ShortcutsView";
import SettingsJsonView from "@/components/settings/SettingsJsonView";
import { useSetting } from "@/store/settings";
import { ViewErrorBoundary } from "@/components/ui/ErrorBoundary";
import { TAB_ICON, closeAll, closeOthers, closeTab, closeToTheRight, openProjectSettings } from "./actions";
import { kbd, shortcut } from "./shortcuts";

/** Renders one editor tab's view (also used by Mission mode pages). A crash stays inside the view. */
export function View({ tab }: { tab: Tab }) {
  return (
    <ViewErrorBoundary key={tab.id} label={tab.title || "This view"}>
      <ViewInner tab={tab} />
    </ViewErrorBoundary>
  );
}

function ViewInner({ tab }: { tab: Tab }) {
  const s = tab.spec;
  switch (s.kind) {
    case "dashboard":
      return <Dashboard />;
    case "board":
      return <Board projectId={s.projectId} />;
    case "file":
      return <FileEditor tabId={tab.id} projectId={s.projectId} path={s.path} />;
    case "deliverable":
      return <DeliverableView tabId={tab.id} id={s.id} />;
    case "run":
      return <RunView id={s.id} />;
    case "seo":
      return <SeoView />;
    case "graphics":
      return <GraphicsView />;
    case "video":
      return <VideoView file={s.file} />;
    case "project":
      return <ProjectHub projectId={s.projectId} section={s.section} intent={s.intent} />;
    case "settings":
      return <SettingsView />;
    case "diff":
      return <DiffView projectId={s.projectId} path={s.path} staged={s.staged} from={s.from} />;
    case "create":
      return <CreateStudio jobId={s.jobId} />;
    case "extension":
      return <ExtensionDetail id={s.id} />;
    case "welcome":
      return <Welcome />;
    case "shortcuts":
      return <ShortcutsView />;
    case "settingsJson":
      return <SettingsJsonView tabId={tab.id} />;
    case "connections":
      return <ConnectionsView category={s.category} />;
    case "ops":
      return <OpsView section={s.section} />;
    case "swarm":
      return <SwarmView id={s.id} tabId={tab.id} />;
    case "swarms":
      return <SwarmsList compose={s.compose} />;
  }
}

function Breadcrumbs({ tab }: { tab: Tab }) {
  const projects = useWorkbench((s) => s.projects);
  const s = tab.spec;
  if (s.kind !== "file" && s.kind !== "diff") return null;
  const project = projects.find((p) => p.id === s.projectId);
  const parts = s.path.split("/").filter(Boolean);
  return (
    <nav aria-label="Breadcrumbs" className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden bg-editor px-2 text-[12px] text-muted">
      <button className="max-w-[40%] shrink-0 truncate rounded-[4px] px-1 hover:bg-hover hover:text-fg" onClick={() => openProjectSettings(s.projectId)} title={`${project?.name ?? "Project"} · project settings`}>
        {project?.name ?? "project"}
      </button>
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
          <span className={`truncate px-0.5 ${i === parts.length - 1 ? "text-fg" : ""}`} title={parts.slice(0, i + 1).join("/")} aria-current={i === parts.length - 1 ? "location" : undefined}>
            {p}
          </span>
        </span>
      ))}
      {s.kind === "diff" && <span className="ml-1 shrink-0 text-faint">({s.staged ? "staged" : "working tree"})</span>}
    </nav>
  );
}

export default function EditorArea() {
  const tabs = useWorkbench((s) => s.tabs);
  const activeTabId = useWorkbench((s) => s.activeTabId);
  const setActiveTab = useWorkbench((s) => s.setActiveTab);
  const openTab = useWorkbench((s) => s.openTab);
  const closeButton = useSetting<string>("workbench.tabCloseButton");
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // Keep the active tab visible when it changes or the strip overflows.
  useEffect(() => {
    if (!activeTabId) return;
    const el = strip.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  // Vertical wheel scrolls the tab strip horizontally (non-passive so we can preventDefault).
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const menuTab = menu ? tabs.findIndex((t) => t.id === menu.id) : -1;

  return (
    <div className="flex h-full flex-col bg-editor">
      {/* VS Code tab strip: inactive tabs and the empty filler carry the bottom border; the active tab doesn't, so it joins the editor. */}
      {tabs.length > 0 && (
      <div className="flex h-[35px] shrink-0 bg-side">
      <div ref={strip} role="tablist" aria-label="Open editors" className="tab-strip flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
        {tabs.map((t, i) => {
          const isActive = t.id === activeTabId;
          const Icon = TAB_ICON[t.spec.kind] ?? LayoutDashboard;
          return (
            <div
              key={t.id}
              data-tab-id={t.id}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              title={t.spec.kind === "file" ? t.spec.path : t.title}
              onClick={() => setActiveTab(t.id)}
              onAuxClick={(e) => e.button === 1 && void closeTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: t.id });
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                  setActiveTab(next.id);
                  requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus());
                } else if (e.key === "Delete") void closeTab(t.id);
                else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left, y: r.bottom, id: t.id });
                }
              }}
              className={`group relative flex min-w-[80px] max-w-56 shrink-0 items-center gap-1.5 border-r border-line pl-3 pr-1 text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${
                isActive ? "bg-editor text-fg" : "border-b text-muted hover:bg-[color-mix(in_srgb,var(--bg-hover)_50%,var(--bg-side))] hover:text-fg"
              }`}
            >
              {isActive && <span className="absolute inset-x-0 top-0 h-px bg-accent" aria-hidden />}
              <Icon size={14} className={`shrink-0 ${isActive ? "text-accent" : "text-faint"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.dirty && <span className="sr-only">, unsaved changes</span>}
              {closeButton === "off" ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
                  {t.dirty && <span className="h-2 w-2 rounded-full bg-fg" />}
                </span>
              ) : (
              <button
                tabIndex={-1}
                className={`icon-btn !h-5 !w-5 ${t.dirty || isActive || closeButton === "always" ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(t.id);
                }}
                title={t.dirty ? `Unsaved changes. Close (${kbd("⌘W")})` : `Close (${kbd("⌘W")})`}
                aria-label={`Close ${t.title}`}
              >
                {t.dirty ? <span className="h-2 w-2 rounded-full bg-fg group-hover:hidden" /> : null}
                <X size={13} className={t.dirty ? "hidden group-hover:block" : ""} />
              </button>
              )}
            </div>
          );
        })}
        <div className="min-w-4 flex-1 border-b border-line" onDoubleClick={() => openTab({ kind: "dashboard" }, "Command Center")} />
      </div>
        <div className="flex shrink-0 items-center border-b border-line px-1">
          {tabs.length > 1 && (
            <button className="icon-btn" title="Close all editors" aria-label="Close all editors" onClick={() => void closeAll()}>
              <XSquare size={14} />
            </button>
          )}
        </div>
      </div>
      )}
      {active && <Breadcrumbs tab={active} />}
      <div data-editor-body className="min-h-0 flex-1 overflow-hidden">
        {active ? (
          // Keep the view keyed by tab so per-tab state resets correctly.
          <div key={active.id} role="tabpanel" className="h-full">
            <View tab={active} />
          </div>
        ) : (
          // Empty editor group: a quiet VS Code-style watermark (mark + shortcut hints), no call-to-action hero.
          <div className="flex h-full select-none flex-col items-center justify-center gap-6 px-6" onDoubleClick={() => openTab({ kind: "dashboard" }, "Command Center")}>
            <div aria-hidden className="text-[72px] font-black leading-none tracking-[-0.04em] text-[color-mix(in_srgb,var(--fg-faint)_22%,var(--bg-editor))]">
              REX
            </div>
            <dl className="grid grid-cols-[minmax(0,auto)_auto] items-center gap-x-4 gap-y-2.5 text-[12.5px]">
              {[
                ["Show all commands", shortcut("palette")],
                ["Go to file", shortcut("quickOpen")],
                ["Find in files", shortcut("search")],
                ["Toggle terminal", shortcut("terminal")],
                ["Toggle agent panel", shortcut("agent")],
              ]
                .filter(([, k]) => k)
                .map(([l, k]) => (
                  <div key={l} className="contents">
                    <dt className="truncate text-right text-muted">{l}</dt>
                    <dd className="flex gap-1">
                      {k.split(" ").map((c) => (
                        <span key={c} className="kbd">
                          {c}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
            <div className="flex gap-4 text-[12px]">
              <button className="text-accent hover:underline" onClick={() => openTab({ kind: "welcome" }, "Welcome")}>
                Open welcome
              </button>
              <button className="text-accent hover:underline" onClick={() => openTab({ kind: "dashboard" }, "Command Center")}>
                Open command center
              </button>
            </div>
          </div>
        )}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Tab actions"
          onClose={() => setMenu(null)}
          items={[
            { label: "Close", hint: kbd("⌘W"), onSelect: () => void closeTab(menu.id) },
            { label: "Close others", disabled: tabs.length < 2, onSelect: () => void closeOthers(menu.id) },
            { label: "Close to the right", disabled: menuTab < 0 || menuTab >= tabs.length - 1, onSelect: () => void closeToTheRight(menu.id) },
            { type: "separator" },
            { label: "Close all", onSelect: () => void closeAll() },
          ]}
        />
      )}
    </div>
  );
}

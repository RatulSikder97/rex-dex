"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Code2, PanelRightOpen, Puzzle, X } from "lucide-react";
import AgentPanel from "@/components/workbench/AgentPanel";
import BottomPanel from "@/components/workbench/BottomPanel";
import { View } from "@/components/workbench/EditorArea";
import Sash from "@/components/workbench/Sash";
import { uiZoom } from "@/components/ui/menu";
import { ViewErrorBoundary } from "@/components/ui/ErrorBoundary";
import { PageHeader } from "@/components/ui/kit";
import { isDialogOpen } from "@/components/ui/dialog";
import { isTypingTarget } from "@/components/workbench/shortcuts";
import ExtensionsPanel from "@/components/sidebar/ExtensionsPanel";
import { TAB_ICON, closeTab } from "@/components/workbench/actions";
import { MISSION_DEFAULTS, MISSION_LIMITS, useWorkbench, type Activity, type MissionTab } from "@/store/workbench";
import { MissionDataProvider } from "./data";
import LeftRail from "./LeftRail";
import { EXTENSIONS_PAGE, openInCodeMode } from "./nav";
import Workspace, { useWorkspaceBadges } from "./Workspace";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MIN_CENTER = 420;

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth / uiZoom()));
  useEffect(() => {
    const on = () => setW(window.innerWidth / uiZoom());
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Activities (palette / shortcuts) that map onto something inside Mission mode instead of the IDE sidebar. */
const ACTIVITY_TO_WORKSPACE: Partial<Record<Activity, MissionTab>> = { runs: "pipeline", plan: "pipeline", library: "output", code: "code" };
const ACTIVITY_TO_CODE_MODE: Activity[] = ["search", "scm"];

/**
 * Mission mode (Manus-style): task list on the left, the agent conversation in the center,
 * and a Workspace on the right (pipeline, live agent, output, issues, optional code).
 */
export default function MissionControl() {
  const vw = useViewportWidth();
  const overlay = vw < 1200;
  const compactRail = vw < 900;
  const railWidth = useWorkbench((s) => s.missionRailWidth);
  const wsWidth = useWorkbench((s) => s.missionWorkspaceWidth);
  const wsOpenWide = useWorkbench((s) => s.missionWorkspaceOpen);
  const page = useWorkbench((s) => s.missionPage);
  const tabs = useWorkbench((s) => s.tabs);
  const terminalLaunch = useWorkbench((s) => s.terminalLaunch);
  const setMission = useWorkbench((s) => s.setMission);
  const [drawer, setDrawer] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const backRef = useRef<() => void>(() => {});
  const goingBack = useRef(false);
  const prevPage = useRef<string | null>(page);

  // A full page (hub, settings, studios…) takes the whole width; the Workspace becomes a drawer meanwhile.
  const asDrawer = overlay || !!page;
  const wsOpen = asDrawer ? drawer : wsOpenWide;
  const wsOpenRef = useRef(wsOpen);
  wsOpenRef.current = wsOpen;
  const railW = compactRail ? 60 : railWidth;

  // Editor tabs opened from anywhere (palette, conversation links, board…) show as a page over the conversation.
  useEffect(
    () =>
      useWorkbench.subscribe((s, prev) => {
        if (s.layoutMode !== "mission") return;
        // Activities (⌘⇧X, palette "View: …") → their Mission equivalent.
        if (s.activity !== prev.activity || (s.sidebarOpen && !prev.sidebarOpen)) {
          if (s.activity === "extensions") return s.setMission({ missionPage: EXTENSIONS_PAGE });
          const wsTab = ACTIVITY_TO_WORKSPACE[s.activity];
          if (wsTab) {
            s.setMission({ missionTab: wsTab, missionWorkspaceOpen: true });
            setDrawer(true);
            return;
          }
          if (ACTIVITY_TO_CODE_MODE.includes(s.activity)) return s.setLayoutMode("code");
        }
        if (s.tabs.length < prev.tabs.length) return; // a tab closed: don't jump to its neighbour
        const t = s.tabs.find((x) => x.id === s.activeTabId);
        if (!t) return;
        const pt = prev.tabs.find((x) => x.id === prev.activeTabId);
        if (s.activeTabId === prev.activeTabId && t.spec === pt?.spec) return;
        if (t.spec.kind === "welcome") return;
        if (t.spec.kind === "file" && s.missionTab === "code" && wsOpenRef.current) return;
        if (s.missionPage !== t.id) s.setMission({ missionPage: t.id });
      }),
    [],
  );

  // Entering Mission mode always lands on the conversation, never on a stale page.
  useEffect(() => {
    useWorkbench.getState().setMission({ missionPage: null });
  }, []);

  // Page history (Back walks it; returning to the conversation clears it).
  useEffect(() => {
    const prev = prevPage.current;
    prevPage.current = page;
    if (goingBack.current) {
      goingBack.current = false;
      return;
    }
    if (!page) history.current = [];
    else if (prev && prev !== page) history.current.push(prev);
  }, [page]);
  const back = () => {
    goingBack.current = true;
    let to: string | null = null;
    while (history.current.length && !to) {
      const id = history.current.pop()!;
      if (id === EXTENSIONS_PAGE || useWorkbench.getState().tabs.some((t) => t.id === id)) to = id;
    }
    setMission({ missionPage: to });
  };
  backRef.current = back;

  // A page whose tab was closed falls back to the conversation.
  const pageTab = page && page !== EXTENSIONS_PAGE ? (tabs.find((t) => t.id === page) ?? null) : null;
  useEffect(() => {
    if (page && page !== EXTENSIONS_PAGE && !pageTab) setMission({ missionPage: null });
  }, [page, pageTab, setMission]);

  // Install / sign-in / interactive agent requests need the terminal: show it as a bottom drawer.
  useEffect(() => {
    if (terminalLaunch) setTerminal(true);
  }, [terminalLaunch]);

  useEffect(() => {
    const open = () => setDrawer(true);
    const chat = () => setDrawer(false);
    window.addEventListener("rex:mission-workspace", open);
    window.addEventListener("rex:mission-focus-chat", chat);
    return () => {
      window.removeEventListener("rex:mission-workspace", open);
      window.removeEventListener("rex:mission-focus-chat", chat);
    };
  }, []);

  // Opening a page closes any Workspace drawer that was showing.
  useEffect(() => {
    if (page) setDrawer(false);
  }, [page]);

  // Esc: close the Workspace drawer first, then leave the page (like Back). Never while typing or in a dialog/menu.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
      if (asDrawer && drawer) return setDrawer(false);
      if (!page || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="menu"],[role="listbox"],[aria-modal="true"]')) return;
      backRef.current();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [asDrawer, drawer, page]);

  const setWsOpen = (open: boolean) => (asDrawer ? setDrawer(open) : setMission({ missionWorkspaceOpen: open }));

  // ---- sashes: mutate the DOM live, commit on release
  const railFor = (d: number) => clamp(railWidth + d, MISSION_LIMITS.rail.min, MISSION_LIMITS.rail.max);
  const wsMax = () => Math.max(MISSION_LIMITS.workspace.min, Math.min(MISSION_LIMITS.workspace.max, window.innerWidth / uiZoom() - railW - MIN_CENTER));
  const wsFor = (d: number) => clamp(wsWidth - d, MISSION_LIMITS.workspace.min, wsMax());

  return (
    <MissionDataProvider>
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-editor">
        <div ref={railRef} className="no-x-scroll h-full shrink-0 overflow-y-hidden border-r border-line" style={{ width: railW, minWidth: railW }}>
          <LeftRail compact={compactRail} />
        </div>
        {!compactRail && (
          <Sash
            orientation="vertical"
            label="Resize task list"
            onDrag={(d) => {
              if (railRef.current) railRef.current.style.width = `${railFor(d)}px`;
            }}
            onEnd={(d) => setMission({ missionRailWidth: railFor(d) })}
            onNudge={(d) => setMission({ missionRailWidth: railFor(d) })}
            onReset={() => setMission({ missionRailWidth: MISSION_DEFAULTS.rail })}
          />
        )}

        <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Task">
          <div data-region="agent" className={`agent-host min-h-0 flex-1 ${page ? "hidden" : ""}`}>
            <ViewErrorBoundary label="The conversation">
              <AgentPanel variant="main" />
            </ViewErrorBoundary>
          </div>
          {page === EXTENSIONS_PAGE && (
            <PageFrame title="Extensions" icon={Puzzle} onBack={back} onCode={() => (openInCodeMode(), useWorkbench.setState({ activity: "extensions", sidebarOpen: true }))}>
              <ViewErrorBoundary label="Extensions">
                <div className="page">
                  <div className="page-inner !max-w-3xl">
                    <PageHeader title="Extensions" description="Add departments, agents, tools, themes and media pipelines." />
                    <div className="-mx-3">
                      <ExtensionsPanel />
                    </div>
                  </div>
                </div>
              </ViewErrorBoundary>
            </PageFrame>
          )}
          {pageTab && (
            <PageFrame
              title={pageTab.title}
              icon={TAB_ICON[pageTab.spec.kind]}
              onBack={back}
              onClose={() => void closeTab(pageTab.id).then((ok) => ok && setMission({ missionPage: null }))}
              onCode={() => {
                useWorkbench.getState().setActiveTab(pageTab.id);
                openInCodeMode();
              }}
            >
              <div key={pageTab.id} className="h-full">
                <View tab={pageTab} />
              </div>
            </PageFrame>
          )}

          {!wsOpen && !page && <WorkspaceButton onClick={() => setWsOpen(true)} />}

          {terminal && (
            <div className="relative h-[300px] shrink-0 border-t border-line bg-panel">
              <button className="icon-btn absolute right-2 top-1 z-10" onClick={() => setTerminal(false)} aria-label="Hide terminal" title="Hide terminal">
                <X size={14} />
              </button>
              <BottomPanel />
            </div>
          )}
        </main>

        {wsOpen && !asDrawer && (
          <>
            <Sash
              orientation="vertical"
              label="Resize workspace"
              onDrag={(d) => {
                if (wsRef.current) wsRef.current.style.width = `${wsFor(d)}px`;
              }}
              onEnd={(d) => setMission({ missionWorkspaceWidth: wsFor(d) })}
              onNudge={(d) => setMission({ missionWorkspaceWidth: wsFor(d) })}
              onReset={() => setMission({ missionWorkspaceWidth: MISSION_DEFAULTS.workspace })}
            />
            <div ref={wsRef} className="h-full shrink-0 overflow-hidden border-l border-line" style={{ width: Math.min(wsWidth, Math.max(MISSION_LIMITS.workspace.min, vw - railW - MIN_CENTER)) }}>
              <ViewErrorBoundary label="The workspace">
                <Workspace onClose={() => setWsOpen(false)} />
              </ViewErrorBoundary>
            </div>
          </>
        )}
        {wsOpen && asDrawer && (
          <>
            <div className="scrim absolute inset-0 z-30 opacity-60" onClick={() => setDrawer(false)} aria-hidden />
            <div className="absolute inset-y-0 right-0 z-40 w-[min(620px,calc(100%-48px))] border-l border-line shadow-[-12px_0_40px_var(--shadow)]" role="dialog" aria-modal="true" aria-label="Workspace">
              <ViewErrorBoundary label="The workspace">
                <Workspace onClose={() => setDrawer(false)} />
              </ViewErrorBoundary>
            </div>
          </>
        )}
      </div>
    </MissionDataProvider>
  );
}

/** Edge tab that brings the Workspace back (sits on the right edge, clear of the conversation header and composer). */
function WorkspaceButton({ onClick }: { onClick: () => void }) {
  const b = useWorkspaceBadges();
  const parts = [b.running ? `${b.running} running` : "", b.issues ? `${b.issues} issue${b.issues === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return (
    <button
      className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-[6px] border border-r-0 border-line bg-elev px-1 py-2.5 text-muted hover:bg-hover hover:text-fg"
      onClick={onClick}
      aria-label={`Show workspace${parts ? ` (${parts})` : ""}`}
      title="Show workspace — pipeline, live agent, output, issues"
    >
      <PanelRightOpen size={15} />
      <span className="text-[11px] font-medium [writing-mode:vertical-rl]">Workspace</span>
      {b.running > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />}
      {b.issues > 0 && (
        <span className={`count ${b.issueErrors ? "!bg-err !text-white" : "!text-warn"}`} aria-hidden>
          {b.issues}
        </span>
      )}
    </button>
  );
}

function PageFrame({
  title,
  icon: Icon,
  onBack,
  onClose,
  onCode,
  children,
}: {
  title: string;
  icon: typeof Puzzle;
  onBack: () => void;
  onClose?: () => void;
  onCode: () => void;
  children: React.ReactNode;
}) {
  const project = useWorkbench((s) => s.projects.find((p) => p.id === s.projectId) ?? null);
  // "REX · Board" style titles already carry the project; show it once, in the breadcrumb.
  const shown = project && title.startsWith(`${project.name} · `) ? title.slice(project.name.length + 3) : title;
  return (
    <div className="flex min-h-0 flex-1 flex-col" role="region" aria-label={shown}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-editor px-2">
        <button className="icon-btn" onClick={onBack} aria-label="Back" title="Back (Esc)">
          <ArrowLeft size={15} />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 pl-1 text-[12.5px]">
          {project && (
            <>
              <span className="max-w-[180px] shrink-0 truncate text-muted">{project.name}</span>
              <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
            </>
          )}
          <Icon size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
          <h2 className="min-w-0 truncate font-medium" title={shown}>
            {shown}
          </h2>
        </nav>
        <button className="btn btn-ghost btn-sm" onClick={onCode} title="Open this in Code mode (IDE)">
          <Code2 size={13} /> <span className="hidden lg:inline">Open in Code mode</span>
        </button>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close page" title="Close page">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

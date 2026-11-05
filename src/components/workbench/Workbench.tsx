"use client";
import SelectHost from "@/components/ui/SelectHost";
import { FolderPickerHost, pickFolder } from "@/components/ui/FolderPicker";
import { LogoStudioHost, openLogoStudio, useProjectFavicon } from "@/components/ProjectLogo";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Run } from "@/lib/types";
import { LAYOUT_DEFAULTS, LAYOUT_LIMITS, useWorkbench } from "@/store/workbench";
import { DialogHost, confirmDialog, isDialogOpen, promptDialog } from "@/components/ui/dialog";
import { ToastHost } from "@/components/ui/toast";
import { uiZoom } from "@/components/ui/menu";
import { initTheme } from "@/components/ui/theme";
import ActivityBar from "./ActivityBar";
import SideBar from "./SideBar";
import EditorArea from "./EditorArea";
import AgentPanel from "./AgentPanel";
import BottomPanel from "./BottomPanel";
import StatusBar from "./StatusBar";
import CommandPalette from "./CommandPalette";
import ThemePicker, { openThemePicker } from "./ThemePicker";
import TitleBar from "./TitleBar";
import Sash from "./Sash";
import { activeTab, closeTab, cycleTab, focusRegion, newProjectFlow, saveActive, saveAll, showActivity, zoom } from "./actions";
import SettingsEffects from "@/components/settings/SettingsEffects";
import MissionControl from "@/components/mission/MissionControl";
import Onboarding, { wasOnboarded } from "@/components/onboarding/Onboarding";
import { getSetting, useSetting } from "@/store/settings";
import { inTerminal, isMac, isTypingTarget } from "./shortcuts";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Waits for the persisted store to rehydrate and the first projects load, so SSR defaults never flash. */
function useBooted(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const projectsLoaded = useWorkbench((s) => s.projectsLoaded);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (useWorkbench.persist.hasHydrated()) setHydrated(true);
    const unsub = useWorkbench.persist.onFinishHydration(() => setHydrated(true));
    // Never hang on the splash if the API is down.
    const t = setTimeout(() => setTimedOut(true), 5000);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, []);
  return hydrated && (projectsLoaded || timedOut);
}

function BootSplash() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-bg" role="status" aria-label="Loading REX">
      <div className="boot-logo text-5xl font-black tracking-tight text-fg">REX</div>
      <div className="boot-bar h-[2px] w-40 overflow-hidden rounded bg-line">
        <span />
      </div>
    </div>
  );
}

export default function Workbench() {
  useProjectFavicon();
  const booted = useBooted();
  const s = useWorkbench();
  const { sidebarOpen, agentOpen, panelOpen, panelMaximized, sidebarWidth, agentWidth, panelHeight, setLayout } = s;
  const sideRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const sideBarLocation = useSetting<string>("workbench.sideBarLocation");
  const activityBarVisible = useSetting<boolean>("workbench.activityBar.visible");
  const statusBarVisible = useSetting<boolean>("workbench.statusBar.visible");

  // ---- data
  useEffect(() => {
    const { loadProjects, loadProviders, loadContributions } = useWorkbench.getState();
    // Boot data must survive a server that's still starting / rebuilding: retry with backoff
    // (1s, 2s, 4s … max 15s) and show a "Reconnecting" banner instead of an empty app.
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const load = (name: string, fn: () => Promise<unknown>, attempt = 0) => {
      fn()
        .then(() => useWorkbench.getState().setConnectionLost(name, false))
        .catch(() => {
          if (stopped) return;
          useWorkbench.getState().setConnectionLost(name, true);
          timers.push(setTimeout(() => load(name, fn, attempt + 1), Math.min(15_000, 1000 * 2 ** attempt)));
        });
    };
    load("projects", loadProjects);
    load("agents", loadProviders);
    load("extensions", loadContributions);
    const stopTheme = initTheme();
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      stopTheme();
    };
  }, []);

  // Dev-only automation hook for UI screenshots / e2e scripts (stripped from production builds).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __rex?: unknown }).__rex = { useWorkbench, confirmDialog, promptDialog, pickFolder, openLogoStudio, openThemePicker };
  }, []);

  // workbench.startupView: applied once per page load, after the persisted layout is restored.
  const startupApplied = useRef(false);
  useEffect(() => {
    if (!booted || startupApplied.current) return;
    startupApplied.current = true;
    // Brand-new customer (no projects, setup never finished or skipped): first-run setup.
    if (useWorkbench.getState().projectsLoaded && !useWorkbench.getState().projects.length && !wasOnboarded()) {
      useWorkbench.getState().setOnboarding(true);
      return;
    }
    const view = getSetting<string>("workbench.startupView");
    const st = useWorkbench.getState();
    if (view === "welcome") st.openTab({ kind: "welcome" }, "Welcome");
    else if (view === "dashboard") st.openTab({ kind: "dashboard" }, "Command Center");
  }, [booted]);

  // Running agent runs drive the badges in the activity bar, title bar, and status bar.
  const version = s.version;
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<Run[]>("/api/runs?limit=50")
        .then((r) => !stop && useWorkbench.getState().setRunningRuns(r.filter((x) => x.status === "running").length))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [version]);

  // ---- keyboard
  useEffect(() => {
    const mac = isMac();
    // ⌘K starts a chord: ⌘K ⌘T (within 1.5s) opens the Color Theme picker.
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isDialogOpen()) return;
      const st = useWorkbench.getState();
      const k = e.key.toLowerCase();
      const typing = isTypingTarget(e.target);
      const terminal = inTerminal(e.target);
      // ⌘ on macOS, Ctrl elsewhere. Inside the terminal on macOS, Ctrl keys belong to the shell.
      const mod = mac ? e.metaKey : e.ctrlKey;
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };

      // Ctrl-based editor bindings (work on every platform).
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") return run(() => cycleTab(e.shiftKey ? -1 : 1));
      if (e.ctrlKey && !e.metaKey && e.key === "`") return run(() => st.setPanelTab("terminal"));
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && k === "w" && !terminal && !(typing && !mac)) {
        const t = activeTab();
        if (t) return run(() => void closeTab(t.id));
      }
      if (!mod) return;
      if (chordAt && Date.now() - chordAt < 1500 && !e.shiftKey && !e.altKey && (k === "t" || e.code === "KeyT")) {
        chordAt = 0;
        return run(() => openThemePicker());
      }
      if (!["Meta", "Control"].includes(e.key)) chordAt = k === "k" && !e.shiftKey && !e.altKey ? Date.now() : 0;
      // Save / Save All / Zoom work everywhere (Monaco included; this runs in the capture phase).
      if (e.code === "KeyS" && !e.shiftKey) return run(() => (e.altKey ? saveAll() : saveActive()));
      if (!e.altKey && !e.shiftKey && (e.key === "=" || e.key === "+")) return run(() => zoom(1));
      if (!e.altKey && e.shiftKey && e.key === "+") return run(() => zoom(1));
      if (!e.altKey && !e.shiftKey && e.key === "-") return run(() => zoom(-1));
      if (!e.altKey && !e.shiftKey && e.key === "0" && !terminal) return run(() => zoom(0));
      // While typing in a field, only shortcuts that include ⌘ fire (they all do), but leave
      // the editor's own text-editing chords alone.
      if (e.altKey) {
        if (e.key === "ArrowRight") return run(() => cycleTab(1));
        if (e.key === "ArrowLeft") return run(() => cycleTab(-1));
        if (k === "n" || e.code === "KeyN") return run(() => void newProjectFlow());
        if (k === "r" || e.code === "KeyR") return run(() => showActivity("runs"));
        return;
      }
      if (e.shiftKey) {
        if (k === "p") return run(() => st.setPalette(true, "commands"));
        if (k === "f") return run(() => showActivity("search"));
        if (k === "g") return run(() => showActivity("scm"));
        if (k === "x") return run(() => showActivity("extensions"));
        if (k === "e") return run(() => showActivity("code"));
        if (k === "i") return run(() => st.toggleAgent());
        if (k === "m") return run(() => st.setLayoutMode(st.layoutMode === "mission" ? "code" : "mission"));
        return;
      }
      switch (k) {
        case "k":
          return run(() => st.setPalette(!(st.paletteOpen && st.paletteMode === "commands"), "commands"));
        case "p":
          return run(() => st.setPalette(true, "files"));
        case "b":
          return run(() => st.toggleSidebar());
        case "l":
          return run(() => st.toggleAgent());
        case "j":
          return run(() => st.togglePanel());
        case ",":
          return run(() => st.openSettings());
        case "n":
          return run(() => void newProjectFlow());
        case "w": {
          const t = activeTab();
          if (t) return run(() => void closeTab(t.id));
          return;
        }
        case "1":
          return run(() => focusRegion("sidebar"));
        case "2":
          return run(() => focusRegion("editor"));
        case "3":
          return run(() => focusRegion("agent"));
      }
    };
    // Capture phase so Monaco/xterm don't swallow workbench chords first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!booted) return <BootSplash />;

  // ---- sash handlers: mutate the DOM live, commit to the store on release.
  const sideWidthFor = (d: number) => sidebarWidth + d;
  // Leave the editor at least ~320px.
  const sideMax = () => Math.max(LAYOUT_LIMITS.sidebar.min, Math.min(LAYOUT_LIMITS.sidebar.max, window.innerWidth / uiZoom() - (activityBarVisible ? 48 : 0) - (agentOpen ? agentWidth : 0) - 320));
  const agentWidthFor = (d: number) => clamp(agentWidth - d, LAYOUT_LIMITS.agent.min, Math.min(LAYOUT_LIMITS.agent.max, window.innerWidth / uiZoom() - 420));
  const panelMax = () => Math.max(LAYOUT_LIMITS.panel.min, (centerRef.current?.clientHeight ?? window.innerHeight) - 90);
  const panelHeightFor = (d: number) => clamp(panelHeight - d, LAYOUT_LIMITS.panel.min, panelMax());

  const right = sideBarLocation === "right";
  // Sash deltas are pointer deltas (+ = right); flip them for panels docked on the other side.
  const sideDelta = (d: number) => (right ? -d : d);
  const agentDelta = (d: number) => (right ? -d : d);

  const sidebar = sidebarOpen && (
    <>
      {right && sidebarSash()}
      <div ref={sideRef} className={`h-full shrink-0 overflow-hidden ${right ? "border-l" : "border-r"} border-line`} style={{ width: sidebarWidth }}>
        <SideBar />
      </div>
      {!right && sidebarSash()}
    </>
  );

  function sidebarSash() {
    return (
      <Sash
        orientation="vertical"
        label="Resize sidebar"
        onDrag={(d) => {
          const w = sideWidthFor(sideDelta(d));
          const el = sideRef.current;
          if (!el) return;
          // Dragging below the threshold previews hiding the sidebar, like VS Code.
          el.style.width = `${w < LAYOUT_LIMITS.sidebar.hideBelow ? 0 : clamp(w, LAYOUT_LIMITS.sidebar.min, sideMax())}px`;
        }}
        onEnd={(d) => {
          const w = sideWidthFor(sideDelta(d));
          if (w < LAYOUT_LIMITS.sidebar.hideBelow) {
            if (sideRef.current) sideRef.current.style.width = `${sidebarWidth}px`;
            setLayout({ sidebarOpen: false });
          } else setLayout({ sidebarWidth: clamp(w, LAYOUT_LIMITS.sidebar.min, sideMax()) });
        }}
        onNudge={(d) => setLayout({ sidebarWidth: clamp(sidebarWidth + sideDelta(d), LAYOUT_LIMITS.sidebar.min, sideMax()) })}
        onReset={() => setLayout({ sidebarWidth: LAYOUT_DEFAULTS.sidebarWidth })}
      />
    );
  }

  const agentSash = (
    <Sash
      orientation="vertical"
      label="Resize agent panel"
      onDrag={(d) => {
        if (agentRef.current) agentRef.current.style.width = `${agentWidthFor(agentDelta(d))}px`;
      }}
      onEnd={(d) => setLayout({ agentWidth: agentWidthFor(agentDelta(d)) })}
      onNudge={(d) => setLayout({ agentWidth: agentWidthFor(agentDelta(d)) })}
      onReset={() => setLayout({ agentWidth: LAYOUT_DEFAULTS.agentWidth })}
    />
  );
  const agent = agentOpen && (
    <>
      {!right && agentSash}
      <div ref={agentRef} data-region="agent" className={`agent-host h-full shrink-0 overflow-hidden ${right ? "border-r" : "border-l"} border-line`} style={{ width: agentWidth }}>
        <AgentPanel />
      </div>
      {right && agentSash}
    </>
  );

  const center = (
    <div ref={centerRef} className="flex min-w-0 flex-1 flex-col">
      <div data-region="editor" tabIndex={-1} className={`min-h-0 flex-1 outline-none ${panelOpen && panelMaximized ? "hidden" : ""}`}>
        <EditorArea />
      </div>
      {panelOpen && (
        <>
          {!panelMaximized && (
            <Sash
              orientation="horizontal"
              label="Resize panel"
              onDrag={(d) => {
                if (panelRef.current) panelRef.current.style.height = `${panelHeightFor(d)}px`;
              }}
              onEnd={(d) => setLayout({ panelHeight: panelHeightFor(d) })}
              onNudge={(d) => setLayout({ panelHeight: clamp(panelHeight - d, LAYOUT_LIMITS.panel.min, panelMax()) })}
              onReset={() => setLayout({ panelHeight: LAYOUT_DEFAULTS.panelHeight })}
            />
          )}
          <div ref={panelRef} className={`min-h-0 shrink-0 ${panelMaximized ? "flex-1" : ""}`} style={panelMaximized ? undefined : { height: Math.min(panelHeight, panelMax()) }}>
            <BottomPanel />
          </div>
        </>
      )}
    </div>
  );

  return (
    // Sized against the CSS zoom on <html> (workbench.zoomLevel) so the workbench always fills the viewport.
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <SettingsEffects />
      <TitleBar />
      <ReconnectBanner />
      {s.onboardingOpen ? (
        <Onboarding />
      ) : s.layoutMode === "mission" ? (
        <MissionControl />
      ) : (
      <div className="flex min-h-0 flex-1">
        {right ? (
          <>
            {agent}
            {center}
            {sidebar}
            {activityBarVisible && <ActivityBar side="right" />}
          </>
        ) : (
          <>
            {activityBarVisible && <ActivityBar side="left" />}
            {sidebar}
            {center}
            {agent}
          </>
        )}
      </div>
      )}
      {statusBarVisible && <StatusBar />}
      <CommandPalette />
      <ThemePicker />
      <ToastHost />
      <DialogHost />
      <FolderPickerHost />
      <LogoStudioHost />
      <SelectHost />
    </div>
  );
}

/** Thin banner while boot data can't be loaded (server starting, restarting or unreachable). */
function ReconnectBanner() {
  const lost = useWorkbench((s) => s.connectionLost);
  if (!lost.length) return null;
  return (
    <div role="status" className="flex h-6 shrink-0 items-center justify-center gap-2 bg-warn/15 text-[11.5px] text-warn">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
      Reconnecting to the REX engine… ({lost.join(", ")})
    </div>
  );
}

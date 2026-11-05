"use client";
import { openLogoStudio } from "@/components/ProjectLogo";
import { useEffect, useMemo, useRef, useState } from "react";
import QuickOpen from "./QuickOpen";
import { LAYOUT_DEFAULTS, useWorkbench, useDepartments, type TabSpec } from "@/store/workbench";
import { ACTIVITIES } from "./ActivityBar";
import { activate, addProjectServer, addUptimeMonitor, cloneRepositoryFlow, connectRepository, newProjectFlow, openFolderFlow, openProjectHub, openSettingsJson, switchProject, zoom } from "./actions";
import { applyThemeChoice, browseThemes, openThemePicker } from "./ThemePicker";
import { confirmDialog } from "@/components/ui/dialog";
import { useSettingsStore } from "@/store/settings";
import { kbd, shortcut } from "./shortcuts";
import { cycleTheme, getThemePref } from "@/components/ui/theme";

let pendingQuery: string | null = null;

/** Opens the command palette with a pre-filled query (e.g. "Go to tab: "). */
export function openPaletteWith(query: string) {
  pendingQuery = query;
  const s = useWorkbench.getState();
  if (s.paletteOpen && s.paletteMode === "commands") s.setPalette(false);
  setTimeout(() => useWorkbench.getState().setPalette(true, "commands"), 0);
}

interface Cmd {
  id: string;
  label: string;
  group: string;
  hint?: string;
  /** Extra text that matches but isn't shown. */
  keywords?: string;
  run: () => void;
}

/**
 * Fuzzy-ish scoring: contiguous substring beats word-prefix beats in-order subsequence.
 * Returns -1 when the query doesn't match.
 */
function score(query: string, text: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const at = t.indexOf(q);
  if (at === 0) return 1000 - t.length;
  if (at > 0) return (/[\s:/·(]/.test(t[at - 1]) ? 800 : 600) - at - t.length / 10;
  // Subsequence with gap penalties.
  let ti = 0;
  let gaps = 0;
  let prev = -1;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    if (prev >= 0) gaps += found - prev - 1;
    prev = found;
    ti = found + 1;
  }
  return 300 - gaps - t.length / 10;
}

export default function CommandPalette() {
  const { departments } = useDepartments();
  const s = useWorkbench();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (s.paletteOpen) {
      setQ(s.paletteMode === "commands" ? (pendingQuery ?? "") : "");
      pendingQuery = null;
      setIdx(0);
    }
  }, [s.paletteOpen, s.paletteMode]);

  const cmds = useMemo<Cmd[]>(() => {
    const open = (spec: TabSpec, title: string) => () => s.openTab(spec, title);
    const out: Cmd[] = [];
    // Activities
    for (const a of ACTIVITIES) out.push({ id: `act-${a.id}`, group: "View", label: `View: ${a.label}`, hint: a.shortcut ? shortcut(a.shortcut) : undefined, run: () => activate(a.id) });
    out.push(
      { id: "act-settings", group: "Preferences", label: "Preferences: Open settings", hint: shortcut("settings"), run: () => s.openSettings() },
      { id: "settings-json", group: "Preferences", label: "Preferences: Open settings (JSON)", keywords: "user settings json", run: () => openSettingsJson() },
      {
        id: "settings-reset",
        group: "Preferences",
        label: "Preferences: Reset all settings",
        run: () =>
          void confirmDialog({ title: "Reset all settings?", message: "Every customized setting returns to its default value.", confirmLabel: "Reset all", danger: true }).then(
            (ok) => ok && useSettingsStore.getState().resetAll(),
          ),
      },
      { id: "zoom-in", group: "View", label: "View: Zoom in", hint: shortcut("zoomIn"), run: () => zoom(1) },
      { id: "zoom-out", group: "View", label: "View: Zoom out", hint: shortcut("zoomOut"), run: () => zoom(-1) },
      { id: "zoom-reset", group: "View", label: "View: Reset zoom", hint: shortcut("zoomReset"), run: () => zoom(0) },
      { id: "settings-agents", group: "Preferences", label: "Preferences: AI agents", keywords: "claude codex cli login", run: () => s.openSettings("settings-agents") },
      { id: "dash", group: "View", label: "Open command center", keywords: "dashboard", run: open({ kind: "dashboard" }, "Command Center") },
      { id: "seo", group: "View", label: "Open SEO & AEO auditor", run: open({ kind: "seo" }, "SEO & AEO") },
      { id: "gfx", group: "View", label: "Open graphics studio", run: open({ kind: "graphics" }, "Graphics Studio") },
      { id: "vid", group: "View", label: "Open video studio", run: open({ kind: "video" }, "Video Studio") },
      { id: "create", group: "View", label: "Open create studio (AI video & audio)", run: open({ kind: "create" }, "Create Studio") },
      { id: "qo", group: "Go", label: "Go to file…", hint: shortcut("quickOpen"), run: () => setTimeout(() => s.setPalette(true, "files"), 0) },
      { id: "term", group: "Terminal", label: "Terminal: Open", hint: shortcut("terminal"), run: () => s.setPanelTab("terminal") },
      { id: "out", group: "View", label: "View: Output", run: () => s.setPanelTab("output") },
      { id: "sb", group: "Layout", label: "View: Toggle sidebar", hint: shortcut("sidebar"), run: () => s.toggleSidebar() },
      { id: "ag", group: "Layout", label: "View: Toggle agent panel", hint: shortcut("agent"), run: () => s.toggleAgent() },
      { id: "pn", group: "Layout", label: "View: Toggle bottom panel", hint: shortcut("panel"), run: () => s.togglePanel() },
      { id: "mode-mission", group: "View", label: "View: Mission mode", hint: s.layoutMode === "code" ? shortcut("layoutMode") : undefined, keywords: "manus tasks pipeline workspace layout", run: () => s.setLayoutMode("mission") },
      { id: "mode-code", group: "View", label: "View: Code mode", hint: s.layoutMode === "mission" ? shortcut("layoutMode") : undefined, keywords: "ide editor vscode layout", run: () => s.setLayoutMode("code") },
      { id: "pmax", group: "Layout", label: "View: Toggle maximized panel", run: () => (s.setLayout({ panelMaximized: !s.panelMaximized }), s.togglePanel(true)) },
      {
        id: "layout-reset",
        group: "Layout",
        label: "View: Reset layout sizes",
        run: () => s.setLayout({ ...LAYOUT_DEFAULTS, panelMaximized: false, sidebarOpen: true }),
      },
      { id: "color-theme", group: "Preferences", label: "Preferences: Color theme", hint: shortcut("colorTheme"), keywords: "theme dark light nord dracula appearance colors", run: () => setTimeout(openThemePicker, 0) },
      { id: "color-theme-browse", group: "Preferences", label: "Preferences: Browse color themes…", keywords: "install theme extensions marketplace", run: () => browseThemes() },
      { id: "theme", group: "Preferences", label: `Preferences: Toggle theme (now ${getThemePref()})`, keywords: "dark light system color", run: () => (useSettingsStore.getState().set("appearance.colorTheme", ""), cycleTheme()) },
      { id: "theme-dark", group: "Preferences", label: "Preferences: Dark theme", run: () => applyThemeChoice("builtin:dark") },
      { id: "theme-light", group: "Preferences", label: "Preferences: Light theme", run: () => applyThemeChoice("builtin:light") },
      { id: "theme-system", group: "Preferences", label: "Preferences: System theme", run: () => applyThemeChoice("builtin:system") },
      ...s.themes.map<Cmd>((t) => ({ id: `color-theme-${t.id}`, group: "Preferences", label: `Preferences: ${t.label} theme`, keywords: `color theme ${t.kind}`, run: () => applyThemeChoice(t.id) })),
      { id: "np", group: "Project", label: "Project: New project…", hint: shortcut("newProject"), run: () => void newProjectFlow() },
      { id: "logo", group: "Project", label: "Project: Generate logo…", keywords: "logo brand icon favicon design", run: () => openLogoStudio() },
      { id: "of", group: "Project", label: "Project: Open folder as project…", run: () => void openFolderFlow() },
      { id: "hub", group: "Project", label: "Project: Open project hub", keywords: "settings repository git servers domains uptime deploy connections agents", run: () => openProjectHub() },
      { id: "hub-git", group: "Project", label: "Project: Connect repository…", keywords: "git github remote origin create clone init", run: () => connectRepository() },
      { id: "hub-server", group: "Project", label: "Project: Add server…", keywords: "ssh vps host deploy", run: () => addProjectServer() },
      { id: "hub-uptime", group: "Project", label: "Project: Add uptime monitor…", keywords: "website domain status ping", run: () => addUptimeMonitor() },
      { id: "clone", group: "Project", label: "Git: Clone repository…", keywords: "github remote new project", run: () => void cloneRepositoryFlow() },
      { id: "help-welcome", group: "Help", label: "Help: Welcome", keywords: "get started walkthrough", run: open({ kind: "welcome" }, "Welcome") },
      { id: "connections", group: "Connections", label: "Connections: Manage third-party connections", keywords: "integrations google analytics search console figma canva premiere after effects notion linear stripe", run: open({ kind: "connections" }, "Connections") },
      { id: "swarm-new", group: "Swarm", label: "Swarm: New swarm…", keywords: "agents parallel multi-agent orchestrate departments goal dag", run: () => s.openTab({ kind: "swarms", compose: Date.now() }, "Swarms") },
      { id: "swarm-list", group: "Swarm", label: "Swarm: Show all swarms", keywords: "agents parallel multi-agent orchestrate pipeline", run: open({ kind: "swarms" }, "Swarms") },
      { id: "ops", group: "Ops", label: "Ops: Open ops center", keywords: "devops servers health monitoring infrastructure", run: open({ kind: "ops" }, "Ops") },
      { id: "ops-servers", group: "Ops", label: "Ops: Servers", keywords: "ssh vps health load memory disk who logged in", run: open({ kind: "ops", section: "servers" }, "Ops") },
      { id: "ops-traffic", group: "Ops", label: "Ops: Traffic", keywords: "nginx access log requests bots crawlers ips", run: open({ kind: "ops", section: "traffic" }, "Ops") },
      { id: "ops-docker", group: "Ops", label: "Ops: Docker", keywords: "containers images compose", run: open({ kind: "ops", section: "docker" }, "Ops") },
      { id: "ops-k8s", group: "Ops", label: "Ops: Kubernetes", keywords: "k8s kubectl pods deployments cluster", run: open({ kind: "ops", section: "k8s" }, "Ops") },
      { id: "ops-uptime", group: "Ops", label: "Ops: Uptime monitors", keywords: "status ping tls certificate website down", run: open({ kind: "ops", section: "uptime" }, "Ops") },
      { id: "ops-git", group: "Ops", label: "Ops: Git & links", keywords: "github remote pull requests ci actions issues website", run: open({ kind: "ops", section: "git" }, "Ops") },
      { id: "help-keys", group: "Help", label: "Help: Keyboard shortcuts", keywords: "keybindings cheatsheet", run: open({ kind: "shortcuts" }, "Keyboard Shortcuts") },
      { id: "notif-clear", group: "Help", label: "Notifications: Clear all", run: () => s.clearNotifications() },
    );
    // Open tabs
    for (const t of s.tabs) out.push({ id: `tab-${t.id}`, group: "Open tabs", label: `Go to tab: ${t.title}`, run: () => s.setActiveTab(t.id) });
    // Projects
    for (const p of s.projects) {
      out.push({ id: `sw-${p.id}`, group: "Project", label: `Switch project: ${p.name}`, keywords: p.stage, run: () => switchProject(p.id) });
      out.push({ id: `ps-${p.id}`, group: "Project", label: `Project hub: ${p.name}`, keywords: "settings", run: () => openProjectHub(p.id) });
    }
    // Departments
    for (const d of departments) {
      out.push({ id: `ask-${d.id}`, group: "Agents", label: `Ask ${d.name} agent`, keywords: d.role, run: () => s.delegate({ department: d.id, brief: "" }) });
      for (const a of d.quickActions) out.push({ id: `${d.id}-${a.label}`, group: "Agents", label: `${d.name}: ${a.label}`, run: () => s.delegate({ department: d.id, brief: a.prompt }) });
    }
    // Terminal agents (dynamic: extensions add more)
    out.push({ id: "agents-manage", group: "Agents", label: "Agent: Manage agents", keywords: "settings cli install login", run: () => s.openSettings("settings-agents") });
    for (const a of s.providers) {
      if (a.interactive && a.available) out.push({ id: `agent-open-${a.id}`, group: "Agents", label: `Agent: Open ${a.label} in terminal`, run: () => s.launchTerminal({ id: a.id, action: "interactive" }) });
      if (a.login) out.push({ id: `agent-login-${a.id}`, group: "Agents", label: `Agent: Sign in to ${a.label}`, run: () => s.launchTerminal({ id: a.id, action: "login" }) });
      if (!a.available && a.install) out.push({ id: `agent-install-${a.id}`, group: "Agents", label: `Agent: Install ${a.label}`, run: () => s.launchTerminal({ id: a.id, action: "install" }) });
    }
    // Extensions
    for (const c of s.pluginCommands) out.push({ id: `plugin-${c.pluginId}-${c.id}`, group: "Extensions", label: c.title, run: () => s.delegate({ department: c.department, brief: c.prompt }) });
    return out;
  }, [s, departments]);

  /** Flat list of rows (with group headings) to render; `items` is just the selectable commands. */
  const { rows, items } = useMemo(() => {
    const t = q.trim();
    if (t) {
      const ranked = cmds
        .map((c) => ({ c, sc: Math.max(score(t, c.label), c.keywords ? score(t, c.keywords) - 200 : -1, score(t, c.group) - 400) }))
        .filter((x) => x.sc >= 0)
        .sort((a, b) => b.sc - a.sc)
        .map((x) => x.c);
      return { rows: ranked.map((c) => ({ c })), items: ranked };
    }
    const byId = new Map(cmds.map((c) => [c.id, c]));
    const recent = s.recentCommands.map((id) => byId.get(id)).filter((c): c is Cmd => !!c);
    const recentIds = new Set(recent.map((c) => c.id));
    const groups = new Map<string, Cmd[]>();
    for (const c of cmds) {
      if (recentIds.has(c.id)) continue;
      groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    }
    const r: ({ heading: string } | { c: Cmd })[] = [];
    const flat: Cmd[] = [];
    const push = (heading: string, list: Cmd[]) => {
      if (!list.length) return;
      r.push({ heading });
      for (const c of list) {
        r.push({ c });
        flat.push(c);
      }
    };
    push("Recently used", recent);
    for (const [g, list] of groups) push(g, list);
    return { rows: r, items: flat };
  }, [cmds, q, s.recentCommands]);

  // Keep the highlighted row visible.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  if (!s.paletteOpen) return null;
  if (s.paletteMode === "files") {
    return (
      <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[44px]" onMouseDown={() => s.setPalette(false)}>
        <div role="dialog" aria-modal="true" aria-label="Go to file" className="popover h-fit w-[600px] max-w-full overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
          <QuickOpen onClose={() => s.setPalette(false)} />
        </div>
      </div>
    );
  }
  const exec = (c?: Cmd) => {
    if (!c) return;
    s.setPalette(false);
    s.pushRecentCommand(c.id);
    c.run();
  };

  let n = -1;
  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[44px]" onMouseDown={() => s.setPalette(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="popover h-fit w-[600px] max-w-full overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="p-1.5">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[idx] ? `cmd-${idx}` : undefined}
          aria-label="Command"
          className="input !h-8 !text-[13px]"
          placeholder="Type a command, project, tab, or department"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") s.setPalette(false);
            else if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(i + 1, items.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)));
            else if (e.key === "PageDown") (e.preventDefault(), setIdx((i) => Math.min(i + 10, items.length - 1)));
            else if (e.key === "PageUp") (e.preventDefault(), setIdx((i) => Math.max(i - 10, 0)));
            else if (e.key === "Home" && !q) (e.preventDefault(), setIdx(0));
            else if (e.key === "End" && !q) (e.preventDefault(), setIdx(items.length - 1));
            else if (e.key === "Enter") (e.preventDefault(), exec(items[idx]));
          }}
        />
        </div>
        <div ref={list} id="palette-list" role="listbox" aria-label="Commands" className="max-h-[min(56vh,440px)] overflow-y-auto pb-1">
          {rows.map((r, i) => {
            if ("heading" in r)
              return (
                <div key={`h-${r.heading}-${i}`} className="section-title flex h-[24px] items-end px-3 pb-1 !text-faint" role="presentation">
                  {r.heading}
                </div>
              );
            const my = ++n;
            const c = r.c;
            return (
              <div
                key={c.id}
                id={`cmd-${my}`}
                data-idx={my}
                role="option"
                aria-selected={my === idx}
                onMouseMove={() => my !== idx && setIdx(my)}
                onClick={() => exec(c)}
                className={`mx-1.5 flex h-[26px] items-center gap-3 rounded-[4px] px-1.5 text-[13px] ${my === idx ? "bg-active" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate" title={c.label.length > 60 ? c.label : undefined}>
                  {c.label}
                </span>
                {q.trim() && <span className="shrink-0 text-[11px] text-faint">{c.group}</span>}
                {c.hint && <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{c.hint}</span>}
              </div>
            );
          })}
          {!items.length && <div className="px-3 py-3 text-[12.5px] text-muted">No commands match “{q.trim()}”.</div>}
        </div>
        <div className="flex h-[28px] items-center gap-3 border-t border-line px-3 text-[11px] text-faint">
          <span>
            <span className="kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> run
          </span>
          <span>
            <span className="kbd">{kbd("⌘P")}</span> files
          </span>
          <span className="ml-auto">
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}

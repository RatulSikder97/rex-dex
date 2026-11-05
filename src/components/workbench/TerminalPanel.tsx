"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, SquareTerminal, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal as XTerm, ITheme } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { api } from "@/lib/client";
import { getSetting, useSettingsStore } from "@/store/settings";
import { useWorkbench, type TerminalAgentLaunch } from "@/store/workbench";
import { kbd } from "./shortcuts";

export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  projectId: string | null;
  pid: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

type TermEvent = { type: "data"; data: string } | { type: "exit"; exitCode: number; signal?: number };

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readTheme(): ITheme {
  const light = document.documentElement.dataset.theme === "light";
  return {
    background: cssVar("--bg-panel", light ? "#ffffff" : "#1e1f22"),
    foreground: cssVar("--fg", light ? "#1e1f22" : "#dfe1e5"),
    cursor: cssVar("--fg", light ? "#1e1f22" : "#dfe1e5"),
    cursorAccent: cssVar("--bg-panel", light ? "#ffffff" : "#1e1f22"),
    selectionBackground: withAlpha(cssVar("--accent", "#3574f0"), "59"),
    black: light ? "#000000" : "#1e1f22",
    red: cssVar("--err", "#f75464"),
    green: cssVar("--ok", "#5fb865"),
    yellow: cssVar("--warn", "#e5c07b"),
    blue: cssVar("--accent", "#3574f0"),
    magenta: light ? "#a626a4" : "#c678dd",
    cyan: light ? "#0184bc" : "#56b6c2",
    white: light ? "#5a5d63" : "#dfe1e5",
    brightBlack: cssVar("--fg-faint", "#6f737a"),
    brightRed: cssVar("--err", "#f75464"),
    brightGreen: cssVar("--ok", "#5fb865"),
    brightYellow: cssVar("--warn", "#e5c07b"),
    brightBlue: light ? "#4078f2" : "#61afef",
    brightMagenta: light ? "#a626a4" : "#d19af0",
    brightCyan: light ? "#0184bc" : "#7fd4de",
    brightWhite: light ? "#1e1f22" : "#ffffff",
  };
}

/** xterm only understands hex/rgb colors, so translucency is expressed as #rrggbbaa. */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color;
}

/** Is the element actually laid out (not inside a display:none ancestor)? */
function visible(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.offsetParent !== null && el.clientWidth > 0 && el.clientHeight > 0;
}

/** One xterm instance bound to one server PTY session. Stays mounted while hidden so scrollback is kept. */
export function TerminalView({ session, active, onExit }: { session: TerminalInfo; active: boolean; onExit: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const lastSize = useRef("");

  const fit = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term || !fitAddon || !visible(host.current)) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    const key = `${term.cols}x${term.rows}`;
    if (key === lastSize.current) return;
    lastSize.current = key;
    void fetch(`/api/terminal/${session.id}/resize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cols: term.cols, rows: term.rows }),
    }).catch(() => {});
  }, [session.id]);

  useEffect(() => {
    let disposed = false;
    let es: EventSource | null = null;
    let ro: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let term: XTerm | null = null;
    const settingsUnsubs: (() => void)[] = [];

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      term = new Terminal({
        fontFamily: getSetting<string>("terminal.fontFamily") || "JetBrains Mono, SF Mono, Menlo, monospace",
        fontSize: getSetting<number>("terminal.fontSize") || 12.5,
        lineHeight: getSetting<number>("terminal.lineHeight") || 1.15,
        cursorBlink: getSetting<boolean>("terminal.cursorBlink") ?? true,
        cursorStyle: getSetting<"block" | "bar" | "underline">("terminal.cursorStyle") || "block",
        scrollback: getSetting<number>("terminal.scrollback") || 5000,
        allowProposedApi: true,
        macOptionIsMeta: true,
        theme: readTheme(),
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      // Terminal settings apply live (Settings → Terminal).
      const unsubSettings = useSettingsStore.subscribe(() => {
        if (!term) return;
        term.options.fontSize = getSetting<number>("terminal.fontSize") || 12.5;
        term.options.fontFamily = getSetting<string>("terminal.fontFamily") || "JetBrains Mono, SF Mono, Menlo, monospace";
        term.options.lineHeight = getSetting<number>("terminal.lineHeight") || 1.15;
        term.options.cursorBlink = getSetting<boolean>("terminal.cursorBlink") ?? true;
        term.options.cursorStyle = getSetting<"block" | "bar" | "underline">("terminal.cursorStyle") || "block";
        fitRef.current?.fit();
      });
      settingsUnsubs.push(unsubSettings);
      term.open(host.current);
      termRef.current = term;
      fitRef.current = fitAddon;

      // Keystrokes are sent strictly in order: one request in flight, the rest coalesced.
      let pending = "";
      let sending = false;
      const flush = async () => {
        if (sending || !pending) return;
        sending = true;
        while (pending && !disposed) {
          const data = pending;
          pending = "";
          await fetch(`/api/terminal/${session.id}/input`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          }).catch(() => {});
        }
        sending = false;
      };
      term.onData((data) => {
        pending += data;
        void flush();
      });

      es = new EventSource(`/api/terminal/${session.id}/stream`);
      let opened = false;
      // Every (re)connect replays the full scrollback, so clear before a replay to avoid duplicates.
      es.onopen = () => {
        if (opened) term?.reset();
        opened = true;
      };
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data) as TermEvent;
        if (ev.type === "data") term?.write(ev.data);
        else {
          term?.write(`\r\n\x1b[2m[process exited with code ${ev.exitCode}]\x1b[0m\r\n`);
          es?.close();
          onExit(session.id);
        }
      };
      es.onerror = () => {
        // The server closes the stream when the session is gone; EventSource would otherwise retry forever.
        if (es?.readyState === EventSource.CLOSED) return;
        fetch("/api/terminal")
          .then((r) => r.json() as Promise<TerminalInfo[]>)
          .then((list) => {
            if (!list.some((t) => t.id === session.id)) {
              es?.close();
              onExit(session.id);
            }
          })
          .catch(() => {});
      };

      ro = new ResizeObserver(() => fit());
      ro.observe(host.current);
      themeObserver = new MutationObserver(() => {
        if (term) term.options.theme = readTheme();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      requestAnimationFrame(() => fit());
    })();

    return () => {
      disposed = true;
      settingsUnsubs.forEach((u) => u());
      es?.close();
      ro?.disconnect();
      themeObserver?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id, fit, onExit]);

  // Re-fit and focus when this tab (or the whole panel) becomes visible.
  const panelOpen = useWorkbench((s) => s.panelOpen);
  const panelTab = useWorkbench((s) => s.panelTab);
  useEffect(() => {
    if (!active || !panelOpen || panelTab !== "terminal") return;
    const r = requestAnimationFrame(() => {
      fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(r);
  }, [active, panelOpen, panelTab, fit]);

  return <div ref={host} className="absolute inset-0 py-1 pl-3 pr-1" style={{ display: active ? "block" : "none" }} />;
}

/** Integrated terminal (bottom panel): xterm.js front-end over server-side node-pty sessions. */
export default function TerminalPanel() {
  const projectId = useWorkbench((s) => s.projectId);
  const panelOpen = useWorkbench((s) => s.panelOpen);
  const panelTab = useWorkbench((s) => s.panelTab);
  const log = useWorkbench((s) => s.log);
  const terminalLaunch = useWorkbench((s) => s.terminalLaunch);
  const clearTerminalLaunch = useWorkbench((s) => s.clearTerminalLaunch);
  const [sessions, setSessions] = useState<TerminalInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [exited, setExited] = useState<Record<string, boolean>>({});
  const creating = useRef(false);
  const autoCreated = useRef(false);

  const create = useCallback(async (agent?: TerminalAgentLaunch, connection?: { id: string }, ssh?: { serverId: string }) => {
    if (creating.current) return;
    creating.current = true;
    try {
      const t = await api<TerminalInfo>("/api/terminal", { method: "POST", json: { projectId, cols: 100, rows: 24, agent, connection, ssh } });
      setSessions((s) => [...(s ?? []), t]);
      setActive(t.id);
    } catch (e) {
      log("error", "terminal", e instanceof Error ? e.message : String(e));
    } finally {
      creating.current = false;
    }
  }, [projectId, log]);

  const kill = useCallback(
    async (id: string) => {
      try {
        await api(`/api/terminal/${id}`, { method: "DELETE" });
      } catch {
        /* already gone server-side */
      }
      setSessions((s) => {
        const next = (s ?? []).filter((t) => t.id !== id);
        setActive((a) => (a === id ? (next[next.length - 1]?.id ?? null) : a));
        return next;
      });
    },
    [],
  );

  const onExit = useCallback((id: string) => setExited((e) => ({ ...e, [id]: true })), []);

  // Menu bar / palette: Terminal → New Terminal / Kill Terminal.
  useEffect(() => {
    const onNew = (e: Event) => {
      e.preventDefault();
      void create();
    };
    const onKill = (e: Event) => {
      e.preventDefault();
      if (active) void kill(active);
    };
    window.addEventListener("rex:terminal-new", onNew);
    window.addEventListener("rex:terminal-kill", onKill);
    return () => {
      window.removeEventListener("rex:terminal-new", onNew);
      window.removeEventListener("rex:terminal-kill", onKill);
    };
  }, [create, kill, active]);

  // Reattach to sessions that survived a page reload.
  useEffect(() => {
    api<TerminalInfo[]>("/api/terminal")
      .then((list) => {
        setSessions(list);
        setActive(list[list.length - 1]?.id ?? null);
        setExited(Object.fromEntries(list.filter((t) => t.exited).map((t) => [t.id, true])));
      })
      .catch(() => setSessions([]));
  }, []);

  // A terminal agent launch requested from elsewhere (agent panel, settings): new session running it.
  useEffect(() => {
    if (!terminalLaunch || !sessions) return;
    autoCreated.current = true;
    clearTerminalLaunch();
    void create(terminalLaunch.agent, terminalLaunch.connection, terminalLaunch.ssh);
  }, [terminalLaunch, sessions, clearTerminalLaunch, create]);

  // Opening the terminal panel with no sessions starts one in the active project's repo.
  useEffect(() => {
    if (autoCreated.current || terminalLaunch || !sessions || sessions.length || !panelOpen || panelTab !== "terminal") return;
    autoCreated.current = true;
    void create();
  }, [sessions, panelOpen, panelTab, create, terminalLaunch]);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {sessions?.map((t) => <TerminalView key={t.id} session={t} active={t.id === active} onExit={onExit} />)}
        {sessions && !sessions.length && (
          <div className="flex h-full items-center justify-center text-[12px] text-faint">
            <button className="btn btn-sm" onClick={() => void create()}>
              <Plus size={13} /> New terminal
            </button>
          </div>
        )}
      </div>
      <div className="flex w-40 shrink-0 flex-col border-l border-line">
        <div className="flex h-6 shrink-0 items-center justify-end gap-0.5 px-1" role="toolbar" aria-label="Terminal actions">
          <button className="icon-btn" title={`New terminal (${kbd("⌃⇧`")})`} aria-label="New terminal" onClick={() => void create()}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title="Kill terminal" aria-label="Kill terminal" disabled={!active} onClick={() => active && void kill(active)}>
            <Trash2 size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Terminals">
          {sessions?.map((t) => (
            <div
              key={t.id}
              role="option"
              aria-selected={t.id === active}
              tabIndex={t.id === active ? 0 : -1}
              title={exited[t.id] ? `${t.cwd} (exited)` : t.cwd}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setActive(t.id))}
              className={`side-row group flex h-[22px] items-center gap-1.5 pl-2 pr-1 text-[12px] outline-none ${t.id === active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
            >
              <SquareTerminal size={13} className={`shrink-0 ${exited[t.id] ? "text-faint" : "text-muted"}`} aria-hidden />
              <span className={`min-w-0 flex-1 truncate ${exited[t.id] ? "text-faint line-through" : ""}`}>
                {t.title}
                <span className="ml-1 text-faint">{t.cwd.split("/").pop()}</span>
              </span>
              <button
                className="icon-btn hidden !h-[18px] !w-[18px] group-hover:inline-flex"
                tabIndex={-1}
                title="Kill terminal"
                aria-label={`Kill ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void kill(t.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

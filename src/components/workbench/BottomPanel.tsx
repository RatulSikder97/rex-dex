"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, ChevronUp, Lock, Trash2, X } from "lucide-react";
import { useWorkbench } from "@/store/workbench";
import TerminalPanel from "./TerminalPanel";
import { withShortcut } from "./shortcuts";

const LEVEL_TEXT = { info: "text-accent", ok: "text-ok", error: "text-err" } as const;

export default function BottomPanel() {
  const logs = useWorkbench((s) => s.logs);
  const togglePanel = useWorkbench((s) => s.togglePanel);
  const panelTab = useWorkbench((s) => s.panelTab);
  const setPanelTab = useWorkbench((s) => s.setPanelTab);
  const maximized = useWorkbench((s) => s.panelMaximized);
  const setLayout = useWorkbench((s) => s.setLayout);
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState<"all" | "error">("all");
  const [follow, setFollow] = useState(true);

  const sources = useMemo(() => Array.from(new Set(logs.map((l) => l.source))).sort(), [logs]);
  const shown = useMemo(() => logs.filter((l) => (source === "all" || l.source === source) && (level === "all" || l.level === "error")), [logs, source, level]);

  useEffect(() => {
    if (follow) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [shown, follow, panelTab]);

  return (
    <section aria-label="Panel" className="flex h-full flex-col border-t border-line bg-panel">
      <div className="flex h-[35px] shrink-0 items-center gap-1 pl-2 pr-2">
        <div
          role="tablist"
          aria-label="Panel views"
          className="flex h-full items-stretch gap-1"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = panelTab === "terminal" ? "output" : "terminal";
            setPanelTab(next);
            document.getElementById(`panel-tab-${next}`)?.focus();
          }}
        >
          {(["terminal", "output"] as const).map((t) => (
            <button
              key={t}
              id={`panel-tab-${t}`}
              role="tab"
              aria-selected={panelTab === t}
              aria-controls={`panel-view-${t}`}
              tabIndex={panelTab === t ? 0 : -1}
              onClick={() => setPanelTab(t)}
              className={`relative flex items-center px-2 text-[11px] font-semibold uppercase tracking-[.04em] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${panelTab === t ? "text-fg" : "text-muted hover:text-fg"}`}
            >
              {t}
              {t === "output" && logs.some((l) => l.level === "error") && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-err" aria-label="has errors" />}
              {panelTab === t && <span className="absolute inset-x-2 bottom-[6px] h-px bg-accent" aria-hidden />}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {panelTab === "output" && (
          <div className="flex items-center gap-1">
            <select className="input !h-[22px] !w-auto max-w-[160px] !py-0 !text-[12px]" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source">
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className="input !h-[22px] !w-auto !py-0 !text-[12px]" value={level} onChange={(e) => setLevel(e.target.value as "all" | "error")} aria-label="Filter by level">
              <option value="all">All levels</option>
              <option value="error">Errors only</option>
            </select>
            <button
              className={`icon-btn ${follow ? "" : "!text-accent"}`}
              title={follow ? "Lock scroll (stop auto-scrolling)" : "Resume auto-scroll"}
              aria-label={follow ? "Lock scroll" : "Resume auto-scroll"}
              aria-pressed={!follow}
              onClick={() => setFollow((f) => !f)}
            >
              {follow ? <ArrowDownToLine size={13} /> : <Lock size={13} />}
            </button>
            <button className="icon-btn" title="Clear output" aria-label="Clear output" onClick={() => useWorkbench.setState({ logs: [] })}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
        <button className="icon-btn" title={maximized ? "Restore panel size" : "Maximize panel size"} aria-label={maximized ? "Restore panel size" : "Maximize panel"} onClick={() => setLayout({ panelMaximized: !maximized })}>
          {maximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button className="icon-btn" title={withShortcut("Close panel", "panel")} aria-label="Close panel" onClick={() => togglePanel(false)}>
          <X size={14} />
        </button>
      </div>
      {/* Terminal stays mounted while hidden so sessions keep streaming. */}
      <div id="panel-view-terminal" role="tabpanel" aria-labelledby="panel-tab-terminal" className={`min-h-0 flex-1 ${panelTab === "terminal" ? "" : "hidden"}`}>
        <TerminalPanel />
      </div>
      <div
        ref={ref}
        id="panel-view-output"
        role="log"
        aria-label="Output"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          if (!atBottom && follow) setFollow(false);
          else if (atBottom && !follow) setFollow(true);
        }}
        className={`min-h-0 flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11.5px] leading-5 ${panelTab === "output" ? "" : "hidden"}`}
      >
        {shown.map((l, i) => (
          <div key={i} className={`-mx-3 flex gap-3 whitespace-pre-wrap px-3 ${l.level === "error" ? "bg-[color-mix(in_srgb,var(--err)_7%,transparent)]" : ""}`}>
            <span className="shrink-0 text-faint">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className={`w-12 shrink-0 text-[11px] uppercase ${LEVEL_TEXT[l.level]}`}>{l.level === "ok" ? "ok" : l.level}</span>
            <span className={`shrink-0 ${LEVEL_TEXT[l.level]}`}>[{l.source}]</span>
            <span className={l.level === "error" ? "text-err" : "text-fg"}>{l.text}</span>
          </div>
        ))}
        {!logs.length && <div className="pt-1 font-sans text-[12px] text-muted">Activity from agents, plans, SEO audits, and video renders appears here.</div>}
        {!!logs.length && !shown.length && <div className="pt-1 font-sans text-[12px] text-muted">No output matches the current filter.</div>}
      </div>
    </section>
  );
}

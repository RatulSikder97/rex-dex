"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Loader2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { OpsSection } from "@/lib/opsTypes";
import { Skeleton } from "@/components/ui/empty";
import { focusConversation } from "@/components/mission/nav";
import { useWorkbench } from "@/store/workbench";

// ---------------------------------------------------------------- data

/** What OpsView hands every section. */
export interface OpsNav {
  projectId: string | null;
  reloadKey: number;
  go: (section: OpsSection, serverId?: string) => void;
  /** Server selected in Servers / Traffic (shared between the two). */
  serverId: string | null;
  setServerId: (id: string | null) => void;
}

/** GET `url` (null = skip). Keeps the previous data while reloading; `reloadKey` forces a refetch. */
export function useOpsFetch<T>(url: string | null, reloadKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** A response (data or error) has arrived at least once. */
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (id !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  return { data, error, loading, loaded, reload: load, setData };
}

const SECTION_IDS: readonly OpsSection[] = ["overview", "servers", "traffic", "docker", "k8s", "uptime", "git"];
export const asSection = (s: string): OpsSection => (SECTION_IDS as readonly string[]).includes(s) ? (s as OpsSection) : "overview";

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hands a brief to a department's agent (in Mission mode, brings the conversation forward first). */
export function handOff(department: string, brief: string, context: string) {
  const s = useWorkbench.getState();
  if (s.layoutMode === "mission") focusConversation();
  s.delegate({ department, brief, context: context.slice(0, 12000) });
}

// ---------------------------------------------------------------- formatting

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
export const fmtNum = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString());

// ---------------------------------------------------------------- primitives

export type Tone = "ok" | "warn" | "err" | "muted" | "accent";
const TONE_CLS: Record<Tone, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  err: "bg-err/15 text-err",
  muted: "bg-elev text-muted",
  accent: "bg-accent/15 text-accent",
};
export const TONE_VAR: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", muted: "var(--fg-faint)", accent: "var(--accent)" };

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ${TONE_CLS[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span role="img" aria-label={label} title={label} className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} />;
}

/** Calm card shell; when `onClick` is set the whole card is a button. */
export function Card({ title, icon, action, children, onClick, className = "" }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; onClick?: () => void; className?: string }) {
  const body = (
    <>
      {(title || action) && (
        <header className="mb-2.5 flex items-center gap-2">
          {icon && <span className="text-muted">{icon}</span>}
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h3>
          {action}
        </header>
      )}
      {children}
    </>
  );
  const cls = `min-w-0 rounded-xl border border-line bg-elev/30 p-3.5 text-left ${className}`;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${cls} block w-full transition-colors hover:border-faint/60 hover:bg-elev/50`}>
        {body}
      </button>
    );
  return <section className={cls}>{body}</section>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate text-[17px] font-semibold tabular-nums" style={tone ? { color: TONE_VAR[tone] } : undefined}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Horizontal usage bar (warn ≥ 75 %, err ≥ 90 % unless thresholds given). */
export function Meter({ value, warn = 75, err = 90, label }: { value: number; warn?: number; err?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const tone: Tone = v >= err ? "err" : v >= warn ? "warn" : "ok";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-elev" role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${v}%`, background: TONE_VAR[tone] }} />
    </div>
  );
}

/** Bar chart (one bar per value), scales to its container width. */
export function Bars({ values, height = 72, color = "var(--accent)", label, highlight }: { values: number[]; height?: number; color?: string; label: string; highlight?: (i: number) => string | null }) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length);
  const w = 100 / n;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label} className="block">
      <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const h = v ? Math.max(1.5, (v / max) * (height - 4)) : 0;
        return <rect key={i} x={i * w + w * 0.12} width={w * 0.76} y={height - h - 1} height={h} rx="0.4" fill={highlight?.(i) ?? color} opacity={0.85} />;
      })}
    </svg>
  );
}

/** Latency sparkline with red ticks for failed checks. */
export function Sparkline({ points, height = 26, label }: { points: { ok: boolean; v: number | null }[]; height?: number; label: string }) {
  if (!points.length) return <div className="h-[26px] text-[11px] leading-[26px] text-faint">no checks yet</div>;
  const vals = points.map((p) => p.v ?? 0);
  const max = Math.max(1, ...vals);
  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => height - 2 - (v / max) * (height - 6);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.v ?? 0).toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label} className="block">
      {points.map((p, i) => (!p.ok ? <rect key={i} x={x(i) - 0.6} width="1.2" y="0" height={height} fill="var(--err)" opacity="0.75" /> : null))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Stacked horizontal distribution bar with a legend. */
export function StackBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-elev" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {total > 0 && parts.map((p) => (p.value ? <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <b className="tabular-nums text-fg">{fmtNum(p.value)}</b>
            <span className="tabular-nums text-faint">{total ? `${Math.round((p.value / total) * 100)}%` : ""}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranked list with proportional background bars. */
export function RankList({ rows, empty = "Nothing yet", mono, max = 10 }: { rows: { key: string; label: ReactNode; count: number; hint?: ReactNode }[]; empty?: string; mono?: boolean; max?: number }) {
  if (!rows.length) return <p className="py-2 text-[12px] text-faint">{empty}</p>;
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-1">
      {rows.slice(0, max).map((r) => (
        <li key={r.key} className="relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-[12px]">
          <span className="absolute inset-y-0 left-0 rounded-md bg-accent/10" style={{ width: `${(r.count / top) * 100}%` }} aria-hidden />
          <span className={`relative min-w-0 flex-1 truncate ${mono ? "font-mono text-[11.5px]" : ""}`}>{r.label}</span>
          {r.hint && <span className="relative shrink-0">{r.hint}</span>}
          <span className="relative shrink-0 tabular-nums text-muted">{fmtNum(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Simple responsive table. */
export function Table({ head, children, label }: { head: ReactNode[]; children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] border-collapse text-[12px]" aria-label={label}>
        <thead>
          <tr className="border-b border-line bg-elev/50 text-left text-[11px] font-medium text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:last-child]:border-0 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-middle">{children}</tbody>
      </table>
    </div>
  );
}

export function ErrorBox({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-err/40 bg-err/10 p-3.5 text-[12.5px]">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-err">{title}</div>
          {children && <div className="mt-1 break-words text-muted">{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function LoadingGrid({ n = 4, h = "h-32" }: { n?: number; h?: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={`${h} !rounded-xl`} />
      ))}
    </div>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn h-7"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="section-title min-w-0 flex-1">{title}</h2>
      {children}
    </div>
  );
}

/** Right-side drawer with monospace output (container / pod logs). */
export function LogsDrawer({ title, load, onClose }: { title: string; load: () => Promise<string>; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fetchLogs = useCallback(async () => {
    setError(null);
    try {
      setText((await load()) ?? "");
    } catch (e) {
      setError(errMsg(e));
    }
  }, [load]);
  const closeCb = useRef(onClose);
  useEffect(() => {
    closeCb.current = onClose;
  });
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeCb.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [text]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-[860px] flex-col border-l border-line bg-editor shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h2>
          <button className="btn h-7" onClick={() => void fetchLogs()}>
            Reload
          </button>
          {text && <CopyButton text={text} />}
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close logs">
            <X size={14} />
          </button>
        </header>
        {error ? (
          <div className="p-4">
            <ErrorBox title="Couldn't load logs">{error}</ErrorBox>
          </div>
        ) : text === null ? (
          <div className="flex items-center gap-2 p-4 text-[12px] text-muted">
            <Spinner /> Loading logs…
          </div>
        ) : (
          <pre ref={preRef} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[11.5px] leading-relaxed text-fg">
            {text.trim() || "(no output)"}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bots

const AI_BOTS = /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic|perplexity|ccbot|google-extended|bytespider|amazonbot|meta-externalagent|cohere|diffbot|youbot|applebot-extended|mistral/i;
const SEARCH_BOTS = /googlebot|bingbot|yandex|duckduckbot|baiduspider|applebot|slurp|seznam|naver|petalbot/i;
const OTHER_BOTS = /bot|crawler|spider|crawl|curl|wget|python-requests|httpclient|go-http|axios|headless|scrapy|ahrefs|semrush|mj12/i;

export function classifyAgent(ua: string): { kind: "ai" | "search" | "bot" | null; name?: string } {
  if (AI_BOTS.test(ua)) return { kind: "ai", name: ua.match(AI_BOTS)?.[0] };
  if (SEARCH_BOTS.test(ua)) return { kind: "search", name: ua.match(SEARCH_BOTS)?.[0] };
  if (OTHER_BOTS.test(ua)) return { kind: "bot", name: ua.match(OTHER_BOTS)?.[0] };
  return { kind: null };
}

/** Rough "who is this" hints for well-known crawler IP ranges (prefix match; a hint, not proof). */
const IP_HINTS: [RegExp, string][] = [
  [/^66\.249\./, "Googlebot"],
  [/^(40\.77|157\.55|207\.46|13\.66)\./, "Bingbot"],
  [/^17\./, "Applebot"],
  [/^(20\.15|20\.171|40\.84|52\.230|23\.98)\./, "OpenAI / Azure"],
  [/^160\.79\.10[4-7]\./, "Anthropic"],
  [/^(31\.13|66\.220|69\.63|69\.171|173\.252)\./, "Meta"],
  [/^(54\.36|51\.222)\./, "Ahrefs (OVH)"],
  [/^185\.191\.171\./, "Semrush"],
  [/^(5\.255|77\.88|87\.250|95\.108|213\.180)\./, "Yandex"],
  [/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/, "private / local"],
];
export function ipHint(ip: string): string | null {
  for (const [re, name] of IP_HINTS) if (re.test(ip)) return name;
  return null;
}

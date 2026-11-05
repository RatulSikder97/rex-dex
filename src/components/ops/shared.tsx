"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Loader2, RotateCw, X } from "lucide-react";
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
export const TONE_VAR: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)", muted: "var(--fg-faint)", accent: "var(--accent)" };

/** Status word on the design-system `pill` class (muted = neutral). */
export function Pill({ tone, children, title, className = "" }: { tone: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`pill shrink-0 ${tone === "muted" ? "" : `pill-${tone}`} ${className}`}>
      {children}
    </span>
  );
}

export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span role="img" aria-label={label} title={label} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_VAR[tone] }} />;
}

/**
 * Flat `card` (radius 6) with an optional `card-head`; when `onClick` is set the whole card is a button.
 * `flush` drops the body padding (tables / row lists that run edge to edge).
 */
export function Card({ title, icon, action, children, onClick, className = "", flush }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; onClick?: () => void; className?: string; flush?: boolean }) {
  const body = (
    <>
      {(title || action) && (
        <header className="card-head">
          {icon && <span className="flex shrink-0 text-muted" aria-hidden>{icon}</span>}
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h3>
          {action && <span className="flex shrink-0 items-center gap-1.5 font-normal">{action}</span>}
        </header>
      )}
      <div className={flush ? "min-w-0" : "card-body min-w-0"}>{children}</div>
    </>
  );
  const cls = `card min-w-0 text-left ${className}`;
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`${cls} flex h-full w-full flex-col items-stretch justify-start transition-colors hover:border-[color-mix(in_srgb,var(--fg-faint)_55%,var(--border))]`}>
        {body}
      </button>
    );
  return <section className={cls}>{body}</section>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className="truncate text-[15px] font-semibold tabular-nums" style={tone ? { color: TONE_VAR[tone] } : undefined}>
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
    <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-hover" role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-[2px]" style={{ width: `${v}%`, background: TONE_VAR[tone] }} />
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
  if (!points.length) return <div className="h-[26px] text-[11px] leading-[26px] text-faint">No checks yet</div>;
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
      <div className="flex h-2 w-full overflow-hidden rounded-[2px] bg-hover" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {total > 0 && parts.map((p) => (p.value ? <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
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
  if (!rows.length) return <p className="py-1 text-[12px] text-faint">{empty}</p>;
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-px">
      {rows.slice(0, max).map((r) => (
        <li key={r.key} className="relative flex h-6 items-center gap-2 overflow-hidden rounded-[4px] px-2 text-[12px]">
          <span className="absolute inset-y-0 left-0 rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" style={{ width: `${(r.count / top) * 100}%` }} aria-hidden />
          <span className={`relative min-w-0 flex-1 truncate ${mono ? "font-mono text-[11.5px]" : ""}`}>{r.label}</span>
          {r.hint && <span className="relative shrink-0">{r.hint}</span>}
          <span className="relative shrink-0 tabular-nums text-muted">{fmtNum(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Data table on the design-system `tbl` class; scrolls horizontally instead of squeezing. */
export function Table({ head, children, label }: { head: ReactNode[]; children: ReactNode; label: string }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="tbl min-w-[520px] [&_tbody_tr:last-child_td]:border-b-0" aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- tool errors

/**
 * Raw CLI / network errors (docker, podman, kubectl, ssh, gh, fetch) → one plain sentence that says
 * what happened and what to do. Backticks mark commands. UI-only mapping; the raw text stays available.
 */
const TOOL_ERRORS: [RegExp, string][] = [
  [/cannot connect to podman/i, "Podman isn't running. Start it with `podman machine start`."],
  [/cannot connect to the docker daemon|is the docker daemon running|docker desktop is (not running|stopped)/i, "Docker isn't running. Start Docker Desktop, OrbStack or Colima, then refresh."],
  [/permission denied.*docker\.sock|docker\.sock.*permission denied/i, "This user can't reach Docker. Add it to the docker group with `sudo usermod -aG docker $USER`."],
  [/docker isn't installed/i, "Docker isn't installed on this Mac. Install Docker Desktop, OrbStack, Colima or Podman."],
  [/kubectl isn't installed/i, "kubectl isn't installed. Install it with `brew install kubectl`."],
  [/no kubernetes context|current-context is not set/i, "No Kubernetes cluster is set up. Point kubectl at one in `~/.kube/config`."],
  [/you must be logged in to the server/i, "kubectl isn't signed in to this cluster. Refresh the cluster credentials, then retry."],
  [/unable to connect to the server|the connection to the server .* was refused|cluster unreachable/i, "The cluster isn't reachable. Make sure it's running and the current context is right."],
  [/permission denied \(publickey/i, "The server rejected your SSH key. Load it with `ssh-add`, or set an identity file on the server."],
  [/host key verification failed/i, "The server's host key isn't trusted yet. Connect once with `ssh user@host` in the terminal and accept it."],
  [/remote host identification has changed/i, "The server's host key changed. If that's expected, remove the old one with `ssh-keygen -R <host>`."],
  [/could not resolve hostname|name or service not known|nodename nor servname|enotfound|getaddrinfo/i, "The host name can't be resolved. Check the address."],
  [/timed out|etimedout/i, "No response before the timeout. Check the address, port and firewall."],
  [/connection refused|econnrefused/i, "The connection was refused. Check that the service is running on that port."],
  [/gh auth login|not logged in(to)? (to )?any github hosts/i, "GitHub CLI isn't signed in. Run `gh auth login`."],
  [/gh: command not found|executable file not found.*\bgh\b/i, "GitHub CLI isn't installed. Run `brew install gh`."],
  [/certificate|cert_|ssl/i, "The TLS certificate isn't valid. Check the site's certificate."],
];

export function friendlyError(raw: string | null | undefined, fallback = "Something went wrong."): { text: string; raw: string | null } {
  const r = (raw ?? "").trim();
  if (!r) return { text: fallback, raw: null };
  for (const [re, text] of TOOL_ERRORS) if (re.test(r)) return { text, raw: r };
  const first = r.replace(/^error:\s*/i, "").split(/\n|(?<=\.)\s/)[0].trim();
  const text = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  return { text: /[.!?…]$/.test(text) ? text : `${text}.`, raw: text.replace(/[.…]$/, "") === r.replace(/[.]$/, "") ? null : r };
}

/** Renders `code` spans inside a friendly sentence. */
export function Sentence({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="whitespace-nowrap rounded-[3px] bg-hover px-1 font-mono text-[11.5px] text-fg">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Collapsed raw tool output under a friendly message. */
export function RawDetail({ raw }: { raw: string | null }) {
  if (!raw) return null;
  return (
    <details className="mt-1.5 text-[11.5px]">
      <summary className="w-fit text-faint hover:text-fg">Details</summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-editor p-2 font-mono text-[11px] leading-relaxed text-muted">{raw}</pre>
    </details>
  );
}

const BOX_TONE = {
  err: { box: "border-[color-mix(in_srgb,var(--err)_40%,var(--border))] bg-[color-mix(in_srgb,var(--err)_7%,var(--bg-side))]", icon: "text-err" },
  warn: { box: "border-[color-mix(in_srgb,var(--warn)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warn)_6%,var(--bg-side))]", icon: "text-warn" },
  muted: { box: "border-line bg-side", icon: "text-muted" },
} as const;

/**
 * Inline problem box. Pass `error` (raw tool text) to get the friendly sentence + collapsed details,
 * or `children` for custom content. `onRetry` adds a Retry button.
 */
export function ErrorBox({ title, children, action, error, onRetry, tone = "err" }: { title: string; children?: ReactNode; action?: ReactNode; error?: string | null; onRetry?: () => void; tone?: keyof typeof BOX_TONE }) {
  const f = error !== undefined ? friendlyError(error) : null;
  const t = BOX_TONE[tone];
  return (
    <div role={tone === "err" ? "alert" : "status"} className={`rounded-[6px] border px-3 py-2.5 text-[12.5px] ${t.box}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className={`mt-px shrink-0 ${t.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{title}</div>
          {f && (
            <p className="mt-0.5 break-words text-[12px] text-muted" title={f.raw ?? undefined}>
              <Sentence text={f.text} />
            </p>
          )}
          {children && <div className="mt-0.5 break-words text-[12px] text-muted">{children}</div>}
          {f && <RawDetail raw={f.raw} />}
        </div>
        {(action || onRetry) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {action}
            {onRetry && (
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                <RotateCw size={12} aria-hidden /> Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LoadingGrid({ n = 4, h = "h-32" }: { n?: number; h?: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={`${h} !rounded-[6px]`} />
      ))}
    </div>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

/** Copy-to-clipboard button; `iconOnly` renders an `icon-btn` (label becomes aria-label/title). */
export function CopyButton({ text, label = "Copy", iconOnly }: { text: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    });
  };
  if (iconOnly)
    return (
      <button type="button" className="icon-btn" onClick={copy} aria-label={done ? "Copied" : label} title={done ? "Copied" : label}>
        {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
      </button>
    );
  return (
    <button type="button" className="btn btn-sm" onClick={copy}>
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

/** Section header inside a view: 15px title, optional one-line description, actions right. */
export function SectionHead({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        <h2 className="section-h">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>}
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
    <div className="fixed inset-0 z-50 flex justify-end bg-[color-mix(in_srgb,var(--bg)_55%,transparent)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-[860px] flex-col border-l border-line bg-editor" style={{ boxShadow: "var(--pop-shadow)" }}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={title}>
            {title}
          </h2>
          <button className="btn btn-sm" onClick={() => void fetchLogs()}>
            <RotateCw size={12} aria-hidden /> Reload
          </button>
          {text && <CopyButton text={text} />}
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close logs" title="Close (Esc)">
            <X size={14} />
          </button>
        </header>
        {error ? (
          <div className="p-3">
            <ErrorBox title="Couldn't load logs" error={error} onRetry={() => void fetchLogs()} />
          </div>
        ) : text === null ? (
          <div className="space-y-1.5 p-3" aria-busy="true" aria-label="Loading logs">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-3.5" />
            ))}
          </div>
        ) : (
          <pre ref={preRef} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11.5px] leading-relaxed text-fg">
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

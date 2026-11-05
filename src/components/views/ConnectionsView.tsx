"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, Check, ChevronDown, Download, ExternalLink, FlaskConical, LogIn, Power, RefreshCw, Search, Settings2, Unplug } from "lucide-react";
import { api, streamRun, applyChunk } from "@/lib/client";
import type { ConnectionInfo, ConnectionStatus, Run } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useActiveProject, useDepartments, useWorkbench } from "@/store/workbench";

const CATEGORY_LABEL: Record<ConnectionInfo["category"], string> = {
  analytics: "Analytics",
  seo: "SEO & search",
  marketing: "Marketing",
  design: "Design",
  video: "Video & motion",
  productivity: "Docs & planning",
  dev: "Engineering",
  commerce: "Revenue",
  social: "Social",
  other: "Other",
};
const CATEGORY_ORDER: ConnectionInfo["category"][] = ["analytics", "seo", "marketing", "design", "video", "productivity", "commerce", "dev", "social", "other"];

const STATUS: Record<ConnectionStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-ok/15 text-ok" },
  "needs-auth": { label: "Sign in needed", cls: "bg-warn/15 text-warn" },
  "needs-setup": { label: "Setup needed", cls: "bg-warn/15 text-warn" },
  "app-missing": { label: "App not installed", cls: "bg-elev text-muted" },
  disabled: { label: "Disabled", cls: "bg-elev text-muted" },
  available: { label: "Not installed", cls: "bg-elev text-muted" },
};

export function useConnections() {
  const version = useWorkbench((s) => s.version);
  const [list, setList] = useState<ConnectionInfo[] | null>(null);
  const load = useCallback(async (refresh = false) => {
    try {
      setList(await api<ConnectionInfo[]>(`/api/connections${refresh ? "?refresh=1" : ""}`));
    } catch {
      setList((l) => l ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { list, load };
}

/**
 * Connections hub: third-party services and desktop apps per department.
 * Services reach the terminal agents as MCP tools; sign-in is the provider's
 * own flow (agent OAuth / CLI login in the terminal), never keys in REX chat.
 */
/** `embedded` drops the page chrome (title, padding, own scroller) for use inside another view (Project hub). */
export default function ConnectionsView({ category, embedded = false }: { category?: string; embedded?: boolean }) {
  const { list, load } = useConnections();
  const { departments } = useDepartments();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(category ?? "all");
  const [dept, setDept] = useState<string>("all");

  // Re-check status when the window regains focus (after signing in in the browser / terminal).
  useEffect(() => {
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter(
      (c) =>
        (cat === "all" || c.category === cat) &&
        (dept === "all" || c.departments.includes(dept)) &&
        (!t || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(t)),
    );
  }, [list, q, cat, dept]);

  const connected = (list ?? []).filter((c) => c.status === "connected").length;
  const grouped = CATEGORY_ORDER.map((k) => [k, shown.filter((c) => c.category === k)] as const).filter(([, v]) => v.length);
  const cats = CATEGORY_ORDER.filter((k) => (list ?? []).some((c) => c.category === k));

  return (
    <div className={embedded ? "" : "h-full overflow-y-auto"}>
      <div className={embedded ? "space-y-5" : "mx-auto max-w-5xl space-y-5 p-6 pb-16"}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {!embedded && (
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Cable size={18} className="text-accent" /> Connections
            </h1>
            <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              Plug your departments into the tools you already use. Click Connect, approve in your browser, done: your agents get the tools. Sign-ins stay on this Mac; desktop apps get one-click hand-off.</p>
          </div>
          )}
          <div className={`flex items-center gap-2 text-[12px] text-muted ${embedded ? "ml-auto" : ""}`}>
            {list && (
              <span>
                <b className="text-fg">{connected}</b> of {list.length} connected
              </span>
            )}
            <button className="btn" onClick={() => void load(true)} title="Re-check every connection">
              <RefreshCw size={12} /> Re-check
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-8" placeholder="Search connections (Analytics, Figma, Premiere…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search connections" />
          </div>
          <select className="input h-7 w-48" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Category">
          {["all", ...cats].map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={cat === k}
              onClick={() => setCat(k)}
              className={`rounded-full border px-3 py-1 text-[12px] ${cat === k ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg"}`}
            >
              {k === "all" ? "All" : CATEGORY_LABEL[k as ConnectionInfo["category"]]}
            </button>
          ))}
        </div>

        {!list && <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">{[0, 1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-elev/60" />)}</div>}
        {list && !shown.length && <p className="py-10 text-center text-[13px] text-muted">No connections match.</p>}

        {grouped.map(([k, items]) => (
          <section key={k} className="space-y-2">
            <h2 className="section-title">{CATEGORY_LABEL[k]}</h2>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {items.map((c) => (
                <ConnectionCard key={c.id} c={c} onChanged={() => void load(true)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({ c, onChanged }: { c: ConnectionInfo; onChanged: () => void }) {
  const { getDepartment } = useDepartments();
  const { launchConnection, log, loadContributions, bump } = useWorkbench();
  const project = useActiveProject();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(c.status === "needs-setup" && c.settings.some((x) => !x.configured));
  const [test, setTest] = useState<{ status: string; text: string } | null>(null);
  const st = STATUS[c.status];

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      onChanged();
      await loadContributions().catch(() => {});
      bump();
    } catch (e) {
      log("error", c.name, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const [login, setLogin] = useState<{ kind: "oauth" | "cli" | "agent"; job?: CliJob | null; url?: string; reason?: string } | null>(null);
  const browserAuth = c.auth === "oauth" || c.auth === "browser-cli" || c.auth === "agent-oauth";
  const connectLabel = c.pluginId.startsWith("google-") ? "Connect with Google" : c.id === "github" ? "Connect with GitHub" : `Connect ${c.name}`;

  // Sign-in finished in the browser (OAuth callback page posts back), or a CLI login completed.
  useEffect(() => {
    if (!login) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; ok?: boolean; connectionId?: string } | null;
      if (d?.type === "rex-oauth" && d.connectionId === c.id) {
        setLogin(null);
        if (d.ok) log("ok", c.name, `${c.name} connected`);
        onChanged();
      }
    };
    window.addEventListener("message", onMsg);
    const t = setInterval(async () => {
      if (login.kind === "agent") return;
      const r = await api<{ job: CliJob | null; connected: boolean }>(`/api/connections/${c.id}`, { method: "POST", json: { action: "connect-status" } }).catch(() => null);
      if (r?.job) setLogin((l) => (l ? { ...l, job: r.job } : l));
      if ((login.kind === "cli" && r?.job?.status === "done") || (login.kind === "oauth" && r?.connected)) {
        setLogin(null);
        log("ok", c.name, `${c.name} connected`);
        onChanged();
      }
    }, 1500);
    return () => {
      window.removeEventListener("message", onMsg);
      clearInterval(t);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- poll per sign-in attempt
  }, [login?.kind, c.id]);

  // Close the waiting state once the list reports the connection as connected.
  useEffect(() => {
    if (login && c.status === "connected") setLogin(null);
  }, [c.status, login]);

  const connect = async () => {
    setBusy("connect");
    try {
      const r = await api<{ kind: "oauth" | "cli" | "agent"; url?: string; job?: CliJob; reason?: string }>(`/api/connections/${c.id}`, { method: "POST", json: { action: "connect" } });
      if (r.kind === "oauth" && r.url) {
        const w = 520;
        const h = 720;
        const win = window.open(r.url, "rex-oauth", `popup=yes,width=${w},height=${h},left=${Math.round(window.screenX + (window.outerWidth - w) / 2)},top=${Math.round(window.screenY + 60)}`);
        if (!win) window.open(r.url, "_blank");
        setLogin({ kind: "oauth", url: r.url });
      } else if (r.kind === "cli") {
        setLogin({ kind: "cli", job: r.job ?? null });
      } else {
        launchConnection(c.id);
        setLogin({ kind: "agent", reason: r.reason });
      }
    } catch (e) {
      log("error", c.name, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const install = (thenConnect = false) =>
    act("install", async () => {
      await api("/api/plugins", { method: "POST", json: { source: c.source } });
      log("ok", "connections", `Installed ${c.name}`);
      if (thenConnect) setTimeout(() => void connect(), 300);
    });
  const enable = () => act("enable", () => api(`/api/plugins/${c.pluginId}`, { method: "PATCH", json: { enabled: true } }));
  const mark = (connected: boolean) => act(connected ? "mark" : "disconnect", () => api(`/api/connections/${c.id}`, { method: "POST", json: { action: connected ? "mark-connected" : "disconnect" } }));

  const runTest = async () => {
    setBusy("test");
    setTest({ status: "running", text: "" });
    try {
      const run = await api<Run>(`/api/connections/${c.id}`, { method: "POST", json: { action: "test", projectId: project?.id ?? null } });
      await new Promise<void>((resolve) => {
        let out = "";
        const close = streamRun(run.id, (ev) => {
          if (ev.type === "chunk") out = applyChunk(out, ev);
          if (ev.type === "snapshot") out = ev.output;
          const status = ev.type === "chunk" ? "running" : ev.status;
          setTest({ status, text: (ev.type !== "chunk" && ev.error) || out });
          if (status !== "running") {
            close();
            const okText = status === "done" && !/NOT CONNECTED/i.test(out);
            if (okText && c.auth === "agent-oauth" && c.status !== "connected") void mark(true);
            resolve();
          }
        });
      });
    } catch (e) {
      setTest({ status: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-line bg-elev/30 p-3.5 transition-colors hover:border-faint/60">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elev">
          <DeptIcon name={c.icon} size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">{c.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${st.cls}`}>{st.label}</span>
            {c.kind === "app" && <span className="text-[10.5px] text-faint">desktop app</span>}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{c.description}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {c.departments.slice(0, 6).map((d) => {
          const dep = getDepartment(d);
          return dep.id === d ? (
            <span key={d} className="flex items-center gap-1 rounded-md bg-elev px-1.5 py-0.5 text-[10.5px] text-muted" title={`Available to ${dep.name}`}>
              <DeptIcon name={dep.icon} color={dep.color} size={10} /> {dep.name}
            </span>
          ) : null;
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {c.status === "available" && (
          <button className="btn btn-primary h-7" disabled={!!busy || !c.source} onClick={() => void install(browserAuth)}>
            {browserAuth ? <LogIn size={12} /> : <Download size={12} />} {busy === "install" ? "Installing…" : browserAuth ? connectLabel : "Install"}
          </button>
        )}
        {c.status === "disabled" && (
          <button className="btn btn-primary h-7" disabled={!!busy} onClick={() => void enable()}>
            <Power size={12} /> Enable
          </button>
        )}
        {(c.status === "needs-auth" || (c.status === "needs-setup" && browserAuth && !c.settings.some((x) => !x.configured))) && (
          <>
            <button className="btn btn-primary h-7" disabled={!!busy || (!!login && login.kind !== "agent")} onClick={() => void connect()}>
              <LogIn size={12} /> {busy === "connect" ? "Opening…" : login ? "Waiting for sign-in…" : connectLabel}
            </button>
            {c.auth === "agent-oauth" && login?.kind === "agent" && (
              <button className="btn h-7" disabled={!!busy} onClick={() => void mark(true)} title="Mark as signed in after approving in the browser">
                <Check size={12} /> Done
              </button>
            )}
          </>
        )}
        {c.kind === "mcp" && (c.status === "connected" || c.status === "needs-auth") && (
          <button className="btn h-7" disabled={!!busy} onClick={() => void runTest()} title="Ask the department's agent which tools it gets from this connection">
            <FlaskConical size={12} /> {busy === "test" ? "Testing…" : "Test"}
          </button>
        )}
        {c.status === "connected" && browserAuth && (
          <button className="btn h-7" onClick={() => void connect()} title="Sign in again (e.g. another account)">
            <RefreshCw size={12} /> Reconnect
          </button>
        )}
        {c.status === "connected" && (c.auth === "agent-oauth" || c.auth === "oauth") && (
          <button className="icon-btn" disabled={!!busy} onClick={() => void mark(false)} title="Disconnect" aria-label="Disconnect">
            <Unplug size={13} />
          </button>
        )}
        {c.status === "connected" && c.kind === "app" && <span className="truncate text-[11px] text-faint" title={c.appPath ?? ""}>Use “Open in…” on any video or image</span>}
        <div className="flex-1" />
        {(c.settings.length > 0 || c.setupHint) && c.installed && (
          <button className="icon-btn" onClick={() => setOpen((o) => !o)} title="Setup" aria-label="Setup" aria-expanded={open}>
            {c.settings.length ? <Settings2 size={13} /> : <ChevronDown size={13} className={open ? "rotate-180" : ""} />}
          </button>
        )}
        {c.docs && (
          <a className="icon-btn" href={c.docs} target="_blank" rel="noreferrer" title="Docs" aria-label={`${c.name} docs`}>
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {login && <SignInProgress name={c.name} login={login} onCancel={() => setLogin(null)} />}

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-[11.5px] leading-relaxed text-muted">{c.statusDetail !== "Install to connect" && c.statusDetail !== "Ready" ? <b className="text-fg">{c.statusDetail}. </b> : null}{c.setupHint}</p>
          {c.installed && c.settings.map((s) => <SettingInput key={s.key} pluginId={c.pluginId} s={s} onSaved={onChanged} />)}
        </div>
      )}

      {test && (
        <div className={`mt-3 rounded-lg border px-2.5 py-2 text-[11.5px] ${test.status === "running" ? "border-line text-muted" : test.status === "done" && !/NOT CONNECTED/i.test(test.text) ? "border-ok/40 bg-ok/10 text-ok" : "border-err/40 bg-err/10 text-err"}`}>
          {test.status === "running" && !test.text ? "Asking the agent…" : test.text.trim().slice(0, 600)}
        </div>
      )}
    </div>
  );
}

function SettingInput({ pluginId, s, onSaved }: { pluginId: string; s: ConnectionInfo["settings"][number]; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const { log } = useWorkbench();
  const save = async () => {
    if (!value.trim()) return;
    try {
      await api(`/api/plugins/${pluginId}/settings`, { method: "PUT", json: { key: s.key, value: value.trim() } });
      setValue("");
      log("ok", "connections", `Saved ${s.title}`);
      onSaved();
    } catch (e) {
      log("error", "connections", e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-medium">{s.title}</span>
        {s.configured && (
          <span className="flex items-center gap-0.5 text-[11px] text-ok">
            <Check size={11} /> set
          </span>
        )}
      </div>
      {s.description && <div className="text-[11px] text-faint">{s.description}</div>}
      <div className="flex gap-1.5">
        <input
          className="input h-7"
          type={s.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={s.configured ? "•••• (enter to replace)" : "Not set"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          aria-label={s.title}
        />
        <button className="btn h-7" onClick={() => void save()} disabled={!value.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

interface CliJob {
  status: "running" | "done" | "error";
  output: string[];
  url: string | null;
  code: string | null;
  error: string | null;
}

/** Live sign-in state: browser window opened / one-time code / CLI progress. */
function SignInProgress({ name, login, onCancel }: { name: string; login: { kind: "oauth" | "cli" | "agent"; job?: CliJob | null; url?: string; reason?: string }; onCancel: () => void }) {
  const job = login.job;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 p-3 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${job?.status === "error" ? "bg-err" : "animate-pulse bg-accent"}`} />
        <span className="flex-1 font-medium text-fg">
          {login.kind === "oauth" && `Approve REX in the ${name} window that just opened…`}
          {login.kind === "agent" && `Claude Code opened its sign-in: choose “${name.toLowerCase()}” and approve in your browser.`}
          {login.kind === "cli" && (job?.status === "error" ? "Sign-in didn't finish" : job?.code ? "Enter this code in your browser" : "Opening your browser to sign in…")}
        </span>
        <button className="text-[11px] text-muted hover:text-fg" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {job?.code && (
        <div className="mt-2 flex items-center gap-2 pl-4">
          <code className="rounded-md bg-elev px-3 py-1.5 font-mono text-[16px] font-semibold tracking-[0.2em] text-fg">{job.code}</code>
          <button
            className="btn h-7"
            onClick={() => {
              void navigator.clipboard.writeText(job.code!);
              setCopied(true);
            }}
          >
            {copied ? <Check size={12} /> : null} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {(login.url || job?.url) && (
        <a className="mt-2 block truncate pl-4 text-[11.5px] text-accent underline" href={login.url ?? job?.url ?? "#"} target="_blank" rel="noreferrer">
          Didn&apos;t open? Open the sign-in page
        </a>
      )}
      {login.kind === "cli" && job && job.output.length > 0 && <div className="mt-1.5 truncate pl-4 font-mono text-[10.5px] text-faint">{job.error ?? job.output[job.output.length - 1]}</div>}
      {login.reason && <div className="mt-1 pl-4 text-[11px] text-muted">{login.reason}</div>}
    </div>
  );
}

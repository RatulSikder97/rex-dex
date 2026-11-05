"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Download, ExternalLink, FlaskConical, LogIn, Power, RefreshCw, Search, SearchX, Settings2, Unplug, X } from "lucide-react";
import { api, streamRun, applyChunk } from "@/lib/client";
import type { ConnectionInfo, ConnectionStatus, Run } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useActiveProject, useDepartments, useWorkbench } from "@/store/workbench";
import { ErrorState, LoadingRows, Page, PageHeader, Pill, Tabs, type Tone } from "@/components/ui/kit";
import { EmptyState } from "@/components/ui/empty";

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

const STATUS: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "ok" },
  "needs-auth": { label: "Sign-in needed", tone: "warn" },
  "needs-setup": { label: "Setup needed", tone: "warn" },
  "app-missing": { label: "App not installed", tone: "neutral" },
  disabled: { label: "Disabled", tone: "neutral" },
  available: { label: "Not installed", tone: "neutral" },
};

/** Rows rendered per page; the rest sit behind "Show more". */
const PAGE = 100;

export function useConnections() {
  const version = useWorkbench((s) => s.version);
  const [list, setList] = useState<ConnectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    try {
      setList(await api<ConnectionInfo[]>(`/api/connections${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList((l) => l ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { list, load, error };
}

/**
 * Connections hub: third-party services and desktop apps per department.
 * Services reach the terminal agents as tools; sign-in is the provider's
 * own flow (browser / CLI login), never keys in REX chat.
 */
/** `embedded` drops the page chrome (title, padding, own scroller) for use inside another view (Project hub). */
export default function ConnectionsView({ category, embedded = false }: { category?: string; embedded?: boolean }) {
  const { list, load, error } = useConnections();
  const { departments } = useDepartments();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(category ?? "all");
  const [dept, setDept] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE);
  const [checking, setChecking] = useState(false);

  // Re-check status when the window regains focus (after signing in in the browser / terminal).
  useEffect(() => {
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const recheck = async () => {
    setChecking(true);
    await load(true);
    setChecking(false);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter(
      (c) =>
        (cat === "all" || c.category === cat) &&
        (dept === "all" || c.departments.includes(dept)) &&
        (!t || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(t)),
    );
  }, [list, q, cat, dept]);
  useEffect(() => setLimit(PAGE), [q, cat, dept]);

  const connected = (list ?? []).filter((c) => c.status === "connected").length;
  const ordered = useMemo(() => CATEGORY_ORDER.flatMap((k) => shown.filter((c) => c.category === k)), [shown]);
  const visible = ordered.slice(0, limit);
  const grouped = CATEGORY_ORDER.map((k) => [k, visible.filter((c) => c.category === k)] as const).filter(([, v]) => v.length);
  const cats = CATEGORY_ORDER.filter((k) => (list ?? []).some((c) => c.category === k));
  const filtered = !!q.trim() || cat !== "all" || dept !== "all";
  const clearFilters = () => {
    setQ("");
    setCat("all");
    setDept("all");
  };

  const countPill = list && (
    <Pill tone={connected ? "ok" : "neutral"} title={`${connected} of ${list.length} connections are signed in and ready`}>
      {connected} of {list.length} connected
    </Pill>
  );
  const recheckBtn = (
    <button className="btn btn-sm" onClick={() => void recheck()} disabled={checking} title="Check the status of every connection again">
      <RefreshCw size={12} className={checking ? "animate-spin" : ""} aria-hidden /> Re-check
    </button>
  );

  const body = (
    <div className="@container min-w-0 space-y-3">
      {embedded && (
        <div className="flex items-center justify-end gap-2">
          {countPill}
          {recheckBtn}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="toolbar" aria-label="Filter connections">
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            className="input pl-7 pr-7"
            placeholder="Search tools and apps"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))}
            aria-label="Search connections"
          />
          {q && (
            <button className="icon-btn absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2" onClick={() => setQ("")} aria-label="Clear search" title="Clear search (Esc)">
              <X size={12} />
            </button>
          )}
        </div>
        <select className="input w-44 shrink-0" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {cats.length > 1 && (
        <Tabs
          label="Category"
          idPrefix="conn-cat"
          value={cat}
          onChange={setCat}
          tabs={["all", ...cats].map((k) => ({
            value: k,
            label: k === "all" ? "All" : CATEGORY_LABEL[k as ConnectionInfo["category"]],
            badge: <span className="count">{k === "all" ? (list ?? []).length : (list ?? []).filter((c) => c.category === k).length}</span>,
          }))}
        />
      )}

      {!list && <LoadingRows rows={6} height={44} />}
      {list && error && !list.length && <ErrorState title="Couldn’t load connections" error={`${error}. Check that REX is running, then retry.`} onRetry={() => void recheck()} />}
      {list && !error && !list.length && <EmptyState icon={SearchX} title="No connections available" hint="Install an extension that adds tools, then re-check." action={{ label: "Re-check", onClick: () => void recheck(), icon: RefreshCw }} />}
      {list && list.length > 0 && !shown.length && (
        <EmptyState icon={SearchX} title="No connections match" hint="Try another search, category or department." action={filtered ? { label: "Clear filters", onClick: clearFilters } : undefined} />
      )}

      {grouped.map(([k, items]) => (
        <section key={k} aria-labelledby={`conn-sec-${k}`} className="space-y-1.5 pt-1">
          {cat === "all" && (
            <h2 id={`conn-sec-${k}`} className="section-title flex items-center gap-1.5">
              {CATEGORY_LABEL[k]} <span className="count">{shown.filter((c) => c.category === k).length}</span>
            </h2>
          )}
          <ul className="overflow-hidden rounded-[6px] border border-line bg-side" aria-label={CATEGORY_LABEL[k]}>
            {items.map((c) => (
              <ConnectionRow key={c.id} c={c} onChanged={() => void load(true)} />
            ))}
          </ul>
        </section>
      ))}

      {ordered.length > limit && (
        <div className="flex justify-center pt-1">
          <button className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({ordered.length - limit} left)
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) return body;
  return (
    <Page>
      <PageHeader title="Connections" description="Give your departments’ agents access to the services and apps you already use." meta={countPill} actions={recheckBtn} />
      {body}
    </Page>
  );
}

function ConnectionRow({ c, onChanged }: { c: ConnectionInfo; onChanged: () => void }) {
  const { getDepartment } = useDepartments();
  const { launchConnection, log, loadContributions, bump } = useWorkbench();
  const project = useActiveProject();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(c.status === "needs-setup" && c.settings.some((x) => !x.configured));
  const [test, setTest] = useState<{ status: string; text: string } | null>(null);
  const st = STATUS[c.status];
  const panelId = `conn-detail-${c.id}`;

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
  const signInLabel = c.pluginId.startsWith("google-") ? "Sign in with Google" : c.id === "github" ? "Sign in with GitHub" : "Sign in";

  // Sign-in finished in the browser (sign-in callback page posts back), or a CLI login completed.
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
      setOpen(true);
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
    setOpen(true);
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

  const needsSignIn = c.status === "needs-auth" || (c.status === "needs-setup" && browserAuth && !c.settings.some((x) => !x.configured));
  const needsSettings = c.status === "needs-setup" && c.installed && c.settings.some((x) => !x.configured);

  // The one action that moves this connection forward, shown on the row.
  const primary =
    c.status === "available" ? (
      <button className="btn btn-sm" disabled={!!busy || !c.source} onClick={() => void install(browserAuth)} title={browserAuth ? `Install ${c.name}, then sign in` : `Install ${c.name}`}>
        <Download size={12} aria-hidden /> {busy === "install" ? "Installing…" : "Install"}
      </button>
    ) : c.status === "disabled" ? (
      <button className="btn btn-sm" disabled={!!busy} onClick={() => void enable()}>
        <Power size={12} aria-hidden /> {busy === "enable" ? "Enabling…" : "Enable"}
      </button>
    ) : needsSignIn ? (
      <>
        {c.auth === "agent-oauth" && login?.kind === "agent" && (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void mark(true)} title="Mark as signed in after approving in the browser">
            <Check size={12} aria-hidden /> Done
          </button>
        )}
        <button className="btn btn-sm" disabled={!!busy || (!!login && login.kind !== "agent")} onClick={() => void connect()}>
          <LogIn size={12} aria-hidden /> {busy === "connect" ? "Opening…" : login ? "Waiting…" : signInLabel}
        </button>
      </>
    ) : needsSettings ? (
      <button className="btn btn-sm" onClick={() => setOpen(true)} aria-controls={panelId}>
        <Settings2 size={12} aria-hidden /> Set up
      </button>
    ) : null;

  const depts = c.departments.map((d) => getDepartment(d)).filter((d, i) => d.id === c.departments[i]);
  const hint = [c.statusDetail !== "Install to connect" && c.statusDetail !== "Ready" ? `${c.statusDetail}.` : "", c.setupHint].filter(Boolean).join(" ");

  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex min-h-11 min-w-0 items-center gap-2 py-1.5 pl-1.5 pr-2 hover:bg-hover">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] py-0.5 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          title={open ? "Hide details" : "Show details"}
        >
          <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-line bg-elev" aria-hidden>
            <DeptIcon name={c.icon} size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-fg">{c.name}</span>
              {c.kind === "app" && <span className="shrink-0 text-[11px] text-faint">Desktop app</span>}
            </span>
            <span className="block truncate text-[12px] text-muted" title={c.description}>
              {c.description}
            </span>
          </span>
        </button>
        <Pill tone={st.tone} title={c.statusDetail} className="shrink-0">
          {st.label}
        </Pill>
        {primary && <div className="flex shrink-0 items-center gap-1">{primary}</div>}
      </div>

      {open && (
        <div id={panelId} className="space-y-3 border-t border-line bg-editor px-4 py-3 pl-[52px] text-[12px]">
          <p className="leading-relaxed text-muted">{c.description}</p>
          {depts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] text-faint">Used by</span>
              {depts.map((dep) => (
                <span key={dep.id} className="flex items-center gap-1 text-[12px] text-muted" title={`Available to ${dep.name}`}>
                  <DeptIcon name={dep.icon} color={dep.color} size={12} /> {dep.name}
                </span>
              ))}
            </div>
          )}
          {hint && <p className="leading-relaxed text-muted">{hint}</p>}
          {c.status === "connected" && c.kind === "app" && <p className="text-muted" title={c.appPath ?? ""}>Use “Open in…” on any video or image to hand it to {c.name}.</p>}

          {login && <SignInProgress name={c.name} login={login} onCancel={() => setLogin(null)} />}

          {c.installed && c.settings.length > 0 && (
            <div className="max-w-[480px] space-y-2.5">
              {c.settings.map((s) => (
                <SettingInput key={s.key} pluginId={c.pluginId} s={s} onSaved={onChanged} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {c.kind === "mcp" && (c.status === "connected" || c.status === "needs-auth") && (
              <button className="btn btn-sm" disabled={!!busy} onClick={() => void runTest()} title="Ask the department’s agent which tools it gets from this connection">
                <FlaskConical size={12} aria-hidden /> {busy === "test" ? "Testing…" : "Test"}
              </button>
            )}
            {c.status === "connected" && browserAuth && (
              <button className="btn btn-sm" disabled={!!busy} onClick={() => void connect()} title="Sign in again, for example with another account">
                <RefreshCw size={12} aria-hidden /> Sign in again
              </button>
            )}
            {c.status === "connected" && (c.auth === "agent-oauth" || c.auth === "oauth") && (
              <button className="btn btn-sm btn-danger-ghost" disabled={!!busy} onClick={() => void mark(false)}>
                <Unplug size={12} aria-hidden /> {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
            {c.docs && (
              <a className="btn btn-sm btn-ghost" href={c.docs} target="_blank" rel="noreferrer" title={`Open ${c.name} docs in your browser`}>
                <ExternalLink size={12} aria-hidden /> Docs
              </a>
            )}
          </div>

          {test && (
            <div
              role="status"
              className={`max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[4px] border px-2.5 py-2 text-[12px] leading-relaxed ${
                test.status === "running" ? "border-line text-muted" : test.status === "done" && !/NOT CONNECTED/i.test(test.text) ? "border-[color-mix(in_srgb,var(--ok)_40%,var(--border))] text-fg" : "border-[color-mix(in_srgb,var(--err)_40%,var(--border))] text-fg"
              }`}
            >
              {test.status === "running" && !test.text ? "Asking the agent…" : test.text.trim().slice(0, 600)}
            </div>
          )}
        </div>
      )}
    </li>
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
  const id = `conn-set-${pluginId}-${s.key}`;
  return (
    <div className="field">
      <label htmlFor={id} className="label flex items-center gap-2">
        {s.title}
        {s.configured && (
          <Pill tone="ok" icon={Check}>
            Set
          </Pill>
        )}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          className="input input-sm"
          type={s.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={s.configured ? "•••• (enter to replace)" : "Not set"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button className="btn btn-sm" onClick={() => void save()} disabled={!value.trim()}>
          Save
        </button>
      </div>
      {s.description && <p className="help">{s.description}</p>}
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
    <div role="status" className="rounded-[6px] border border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${job?.status === "error" ? "bg-err" : "bg-accent"}`} aria-hidden />
        <span className="min-w-0 flex-1 font-medium text-fg">
          {login.kind === "oauth" && `Approve REX in the ${name} window that just opened.`}
          {login.kind === "agent" && `Claude Code opened its sign-in: choose “${name.toLowerCase()}” and approve in your browser.`}
          {login.kind === "cli" && (job?.status === "error" ? "Sign-in didn’t finish. Try again." : job?.code ? "Enter this code in your browser" : "Opening your browser to sign in…")}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {job?.code && (
        <div className="mt-2 flex items-center gap-2 pl-4">
          <code className="rounded-[4px] border border-line bg-elev px-2.5 py-1 font-mono text-[15px] font-semibold tracking-[0.2em] text-fg">{job.code}</code>
          <button
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(job.code!);
              setCopied(true);
            }}
          >
            {copied ? <Check size={12} aria-hidden /> : null} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {(login.url || job?.url) && (
        <a className="mt-2 block truncate pl-4 text-[12px] text-accent underline" href={login.url ?? job?.url ?? "#"} target="_blank" rel="noreferrer">
          Didn&apos;t open? Open the sign-in page
        </a>
      )}
      {login.kind === "cli" && job && job.output.length > 0 && (
        <div className="mt-1.5 truncate pl-4 font-mono text-[11px] text-faint" title={job.error ?? job.output[job.output.length - 1]}>
          {job.error ?? job.output[job.output.length - 1]}
        </div>
      )}
      {login.reason && <div className="mt-1 pl-4 text-[11px] text-muted">{login.reason}</div>}
    </div>
  );
}

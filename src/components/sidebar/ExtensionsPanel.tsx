"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, PackageSearch, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { api } from "@/lib/client";
import type { CatalogEntry, InstalledPlugin } from "@/lib/plugins/types";
import { DeptIcon } from "@/components/icons";
import { useWorkbench } from "@/store/workbench";
import { useSetting } from "@/store/settings";
import { applyThemeChoice } from "@/components/workbench/ThemePicker";
import { ErrorState, LoadingRows, Pill, Switch } from "@/components/ui/kit";
import { EmptyState } from "@/components/ui/empty";

/** Rows rendered per section; the rest sit behind "Show more". */
const PAGE = 100;

/** Shared by the sidebar and the detail view: install, then refresh everything plugins contribute. */
export function useExtensionActions() {
  const { loadContributions, loadProviders, bump, log } = useWorkbench();
  // Extensions can contribute departments, commands, pipelines and terminal agents.
  const refresh = useCallback(async () => {
    await Promise.all([loadContributions().catch(() => {}), loadProviders().catch(() => {})]);
    bump();
  }, [loadContributions, loadProviders, bump]);
  const install = useCallback(
    async (source: string) => {
      log("info", "extensions", `Installing ${source}…`);
      try {
        const m = await api<{ id: string; name: string }>("/api/plugins", { method: "POST", json: { source } });
        log("ok", "extensions", `Installed ${m.name}`);
        await refresh();
        return m;
      } catch (e) {
        log("error", "extensions", e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [log, refresh],
  );
  return { install, refresh };
}

export default function ExtensionsPanel() {
  const { openTab, version, log } = useWorkbench();
  const { install, refresh } = useExtensionActions();
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A fresh "search extensions for…" request (e.g. "Browse more themes…" → "@themes") prefills the box.
  const extensionsQuery = useWorkbench((s) => s.extensionsQuery);
  const [q, setQ] = useState(() => (extensionsQuery && Date.now() - extensionsQuery.key < 10_000 ? extensionsQuery.q : ""));
  useEffect(() => {
    if (extensionsQuery && Date.now() - extensionsQuery.key < 10_000) setQ(extensionsQuery.q);
  }, [extensionsQuery]);
  const themes = useWorkbench((s) => s.themes);
  const colorTheme = useSetting<string>("appearance.colorTheme");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, c] = await Promise.all([api<InstalledPlugin[]>("/api/plugins"), api<CatalogEntry[]>("/api/plugins/catalog")]);
      setInstalled(i);
      setCatalog(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, version]);

  const match = useCallback(
    (name: string, desc: string, cats: string[]) => {
      const t = q.trim().toLowerCase();
      if (!t) return true;
      if (t.startsWith("@")) return cats.some((c) => c.toLowerCase().includes(t.slice(1)));
      return `${name} ${desc} ${cats.join(" ")}`.toLowerCase().includes(t);
    },
    [q],
  );

  const shownInstalled = useMemo(() => (installed ?? []).filter((p) => match(p.manifest.name, p.manifest.description, p.manifest.categories)), [installed, match]);
  const shownCatalog = useMemo(() => catalog.filter((c) => !c.installed && match(c.name, c.description, c.categories)), [catalog, match]);

  const doInstall = async (src: string, key: string) => {
    setBusy(key);
    const m = await install(src);
    setBusy(null);
    await load();
    if (m) openTab({ kind: "extension", id: m.id }, `Extension: ${m.name}`);
  };

  const setEnabled = async (p: InstalledPlugin, enabled: boolean) => {
    setBusy(p.manifest.id);
    // Optimistic: flip the switch now, reconcile with the server after.
    setInstalled((l) => l && l.map((x) => (x.manifest.id === p.manifest.id ? { ...x, enabled } : x)));
    try {
      await api(`/api/plugins/${p.manifest.id}`, { method: "PATCH", json: { enabled } });
      log("ok", "extensions", `${enabled ? "Enabled" : "Disabled"} ${p.manifest.name}`);
      await refresh();
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const open = (id: string, name: string) => openTab({ kind: "extension", id }, `Extension: ${name}`);

  return (
    <div className="@container pb-3">
      <div className="flex items-center gap-1 px-3 pb-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            className="input pl-7 pr-7"
            placeholder="Search extensions"
            aria-label="Search extensions"
            title="Search by name, or by category with @ (for example @themes)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))}
          />
          {q && (
            <button className="icon-btn absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2" onClick={() => setQ("")} aria-label="Clear search" title="Clear search (Esc)">
              <X size={12} />
            </button>
          )}
        </div>
        <button className="icon-btn icon-btn-lg" title="Refresh" aria-label="Refresh extensions" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {installed === null && !error && <LoadingRows rows={6} height={40} className="px-3" />}
      {error && installed === null && <ErrorState compact title="Couldn’t load extensions" error={`${error}. Check that REX is running, then retry.`} onRetry={() => void load()} />}

      {installed !== null && (
        <>
          <Section id="installed" title="Installed" count={shownInstalled.length}>
            <CappedList
              items={shownInstalled}
              render={(p) => {
                const own = p.enabled ? themes.filter((t) => t.pluginId === p.manifest.id) : [];
                const active = own.some((t) => t.id === colorTheme);
                return (
                  <ExtRow
                    key={p.manifest.id}
                    icon={p.manifest.icon}
                    name={p.manifest.name}
                    description={p.manifest.description}
                    author={p.manifest.author}
                    muted={!p.enabled}
                    status={
                      p.error ? (
                        <Pill tone="err" title={p.error}>
                          Error
                        </Pill>
                      ) : p.hasCode && !p.trusted ? (
                        <Pill tone="warn" icon={ShieldAlert} title="Contains code that stays inactive until you trust it">
                          Not trusted
                        </Pill>
                      ) : active ? (
                        <Pill tone="accent" title="This extension's color theme is in use">
                          Active
                        </Pill>
                      ) : !p.enabled ? (
                        <Pill>Disabled</Pill>
                      ) : null
                    }
                    onOpen={() => open(p.manifest.id, p.manifest.name)}
                    action={
                      <>
                        {own.length > 0 && !active && (
                          <button className="btn btn-sm hidden @xs:inline-flex" title={`Use the ${own[0].label} color theme`} onClick={() => applyThemeChoice(own[0].id)}>
                            Apply
                          </button>
                        )}
                        <Switch checked={p.enabled} disabled={busy === p.manifest.id} label={`${p.enabled ? "Disable" : "Enable"} ${p.manifest.name}`} onChange={(v) => void setEnabled(p, v)} />
                      </>
                    }
                  />
                );
              }}
            />
            {!shownInstalled.length && <p className="px-3 py-1 text-[12px] text-muted">{q ? "No installed extensions match." : "No extensions installed yet."}</p>}
          </Section>

          <Section id="recommended" title="Recommended" count={shownCatalog.length}>
            <CappedList
              items={shownCatalog}
              render={(c) => (
                <ExtRow
                  key={`${c.registry}:${c.id}`}
                  icon={c.icon}
                  name={c.name}
                  description={c.description}
                  author={`${c.author}${c.registry && c.registry !== "REX" ? ` · ${c.registry}` : ""}`}
                  status={
                    c.hasCode ? (
                      <Pill icon={ShieldAlert} title="Contains code: you'll be asked to trust it">
                        Code
                      </Pill>
                    ) : null
                  }
                  onOpen={() => open(c.id, c.name)}
                  action={
                    <button className="btn btn-sm" disabled={busy === c.id} onClick={() => void doInstall(c.source, c.id)} title={`Install ${c.name}`}>
                      {busy === c.id ? "Installing…" : "Install"}
                    </button>
                  }
                />
              )}
            />
            {!shownCatalog.length &&
              (q ? (
                <EmptyState compact icon={PackageSearch} title="Nothing in the marketplace matches" hint="Try another word, or a category such as @themes." action={{ label: "Clear search", onClick: () => setQ("") }} />
              ) : (
                <p className="px-3 py-1 text-[12px] text-muted">Everything in the marketplace is installed.</p>
              ))}
          </Section>

          <Section id="source" title="Install from source" defaultOpen={false}>
            <div className="space-y-2 px-3">
              <label htmlFor="ext-source" className="label">
                Git URL or folder
              </label>
              <div className="flex gap-1.5">
                <input
                  id="ext-source"
                  className="input font-mono text-[12px]"
                  placeholder="https://github.com/you/rex-ext.git"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && source.trim() && void doInstall(source.trim(), "source")}
                />
                <button className="btn shrink-0" disabled={!source.trim() || busy === "source"} onClick={() => void doInstall(source.trim(), "source")}>
                  <Download size={13} aria-hidden /> {busy === "source" ? "Installing…" : "Install"}
                </button>
              </div>
              <p className="help">
                An extension is a folder with a <code>rex-plugin.json</code>. Add more marketplaces in Settings, Extensions.
              </p>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function CappedList<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const [limit, setLimit] = useState(PAGE);
  if (!items.length) return null;
  return (
    <>
      <ul>{items.slice(0, limit).map(render)}</ul>
      {items.length > limit && (
        <div className="px-3 pt-1">
          <button className="btn btn-sm w-full" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({items.length - limit} left)
          </button>
        </div>
      )}
    </>
  );
}

function Section({ id, title, count, defaultOpen = true, children }: { id: string; title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="pb-2" aria-labelledby={`ext-sec-${id}`}>
      <h2 className="m-0">
        <button
          id={`ext-sec-${id}`}
          type="button"
          className="section-title flex h-7 w-full items-center gap-1 px-2 text-left hover:text-fg"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`ext-body-${id}`}
        >
          <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
          {title}
          {count !== undefined && <span className="count ml-1 normal-case tracking-normal">{count}</span>}
        </button>
      </h2>
      {open && <div id={`ext-body-${id}`}>{children}</div>}
    </section>
  );
}

function ExtRow(props: {
  icon: string;
  name: string;
  description: string;
  author: string;
  muted?: boolean;
  status?: React.ReactNode;
  action?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 pr-3 hover:bg-hover">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-3 text-left" onClick={props.onOpen} title={`Open ${props.name}`}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-line bg-elev text-muted" aria-hidden>
          <DeptIcon name={props.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`truncate text-[13px] font-medium ${props.muted ? "text-muted" : "text-fg"}`}>{props.name}</span>
            {props.status}
            <span className="hidden min-w-0 truncate text-[11px] text-faint @xs:inline" title={props.author}>
              {props.author}
            </span>
          </span>
          <span className="block truncate text-[12px] text-muted" title={props.description}>
            {props.description}
          </span>
        </span>
      </button>
      {props.action && <div className="flex shrink-0 items-center gap-1.5">{props.action}</div>}
    </li>
  );
}

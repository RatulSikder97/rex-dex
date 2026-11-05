"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "@/lib/client";
import type { CatalogEntry, InstalledPlugin } from "@/lib/plugins/types";
import { DeptIcon } from "@/components/icons";
import { useWorkbench } from "@/store/workbench";
import { useSetting } from "@/store/settings";
import { ThemeSwatches, applyThemeChoice, choiceOf } from "@/components/workbench/ThemePicker";

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
  const { openTab, version } = useWorkbench();
  const { install } = useExtensionActions();
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
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
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load().catch(() => {});
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

  const shownInstalled = useMemo(() => installed.filter((p) => match(p.manifest.name, p.manifest.description, p.manifest.categories)), [installed, match]);
  const shownCatalog = useMemo(() => catalog.filter((c) => !c.installed && match(c.name, c.description, c.categories)), [catalog, match]);

  const doInstall = async (src: string, key: string) => {
    setBusy(key);
    const m = await install(src);
    setBusy(null);
    await load();
    if (m) openTab({ kind: "extension", id: m.id }, `Extension: ${m.name}`);
  };

  return (
    <div className="pb-3">
      <div className="space-y-2 px-3 pb-2">
        <div className="flex gap-1">
          <input className="input" placeholder="Search extensions (try @themes, @agents, @mcp)" aria-label="Search extensions" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="icon-btn h-7 w-7 shrink-0" title="Refresh" onClick={() => load()}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <Section title={`Installed (${shownInstalled.length})`}>
        {shownInstalled.map((p) => {
          const own = p.enabled ? themes.filter((t) => t.pluginId === p.manifest.id) : [];
          const active = own.some((t) => t.id === colorTheme);
          return (
          <ExtRow
            key={p.manifest.id}
            icon={p.manifest.icon}
            name={p.manifest.name}
            description={p.manifest.description}
            author={p.manifest.author}
            dim={!p.enabled}
            badge={
              p.error ? (
                <span className="text-[10.5px] text-err" title={p.error}>error</span>
              ) : p.hasCode && !p.trusted ? (
                <span title="Contains code: not trusted yet"><ShieldAlert size={12} className="text-warn" /></span>
              ) : !p.enabled ? (
                <span className="text-[10.5px] text-faint">disabled</span>
              ) : null
            }
            onClick={() => openTab({ kind: "extension", id: p.manifest.id }, `Extension: ${p.manifest.name}`)}
            action={
              own.length ? (
                <span className="flex items-center gap-1.5">
                  <ThemeSwatches colors={choiceOf(own.find((t) => t.id === colorTheme) ?? own[0]).colors} />
                  {active ? (
                    <span className="text-[10.5px] text-accent">Active</span>
                  ) : (
                    <button
                      className="btn h-5 px-2 text-[11px]"
                      title={`Apply ${own[0].label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        applyThemeChoice(own[0].id);
                      }}
                    >
                      Apply
                    </button>
                  )}
                </span>
              ) : undefined
            }
          />
          );
        })}
        {!shownInstalled.length && <p className="px-3 py-1 text-[12px] text-muted">No installed extensions{q ? " match" : ""}.</p>}
      </Section>

      <Section title={`Marketplace (${shownCatalog.length})`}>
        {shownCatalog.map((c) => (
          <ExtRow
            key={`${c.registry}:${c.id}`}
            icon={c.icon}
            name={c.name}
            description={c.description}
            author={`${c.author}${c.registry && c.registry !== "REX" ? ` · ${c.registry}` : ""}`}
            badge={c.hasCode ? <span title="Contains code: you'll be asked to trust it"><ShieldAlert size={12} className="text-faint" /></span> : null}
            onClick={() => openTab({ kind: "extension", id: c.id }, `Extension: ${c.name}`)}
            action={
              <button
                className="btn btn-primary h-5 px-2 text-[11px]"
                disabled={busy === c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  doInstall(c.source, c.id);
                }}
              >
                {busy === c.id ? "…" : "Install"}
              </button>
            }
          />
        ))}
        {!shownCatalog.length && <p className="px-3 py-1 text-[12px] text-muted">Everything here is installed.</p>}
      </Section>

      <Section title="Install from source">
        <div className="space-y-2 px-3">
          <input
            className="input font-mono text-[11.5px]"
            placeholder="https://github.com/you/rex-ext.git or /abs/path"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && source.trim() && doInstall(source.trim(), "source")}
          />
          <button className="btn w-full justify-center" disabled={!source.trim() || busy === "source"} onClick={() => doInstall(source.trim(), "source")}>
            <Download size={13} /> {busy === "source" ? "Installing…" : "Install"}
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            A REX extension is a folder with a <code>rex-plugin.json</code>. Add remote marketplaces in Settings → Extensions.
          </p>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pb-2">
      <button className="flex w-full items-center px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open && children}
    </div>
  );
}

function ExtRow(props: {
  icon: string;
  name: string;
  description: string;
  author: string;
  dim?: boolean;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div onClick={props.onClick} className={`flex cursor-pointer gap-2.5 px-3 py-2 hover:bg-hover ${props.dim ? "opacity-55" : ""}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-elev">
        <DeptIcon name={props.icon} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">{props.name}</span>
          {props.badge}
        </div>
        <div className="line-clamp-2 text-[11.5px] leading-snug text-muted">{props.description}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10.5px] text-faint">{props.author}</span>
          {props.action}
        </div>
      </div>
    </div>
  );
}

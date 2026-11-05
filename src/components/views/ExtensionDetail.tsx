"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, ExternalLink, PackageX, Plug, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/client";
import type { CatalogEntry, InstalledPlugin } from "@/lib/plugins/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { confirmDialog } from "@/components/ui/dialog";
import { useExtensionActions } from "@/components/sidebar/ExtensionsPanel";
import { useAgents, useWorkbench } from "@/store/workbench";
import { useSetting } from "@/store/settings";
import { ThemePreview, applyThemeChoice, choiceOf, openThemePicker } from "@/components/workbench/ThemePicker";
import { ErrorState, Page, Pill, Switch, Tabs } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";

interface McpInfo {
  name: string;
  pluginId: string;
  command: string;
  args: string[];
  envKeys: string[];
  missing: string[];
}

type Section = "overview" | "features" | "settings";

export default function ExtensionDetail({ id }: { id: string }) {
  const { log, closeTab, delegate, launchTerminal, loadProviders, openTab } = useWorkbench();
  const { install, refresh } = useExtensionActions();
  const agents = useAgents();
  const colorTheme = useSetting<string>("appearance.colorTheme");
  const [plugin, setPlugin] = useState<InstalledPlugin | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [mcp, setMcp] = useState<McpInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>("features");

  const load = useCallback(async () => {
    try {
      try {
        const p = await api<InstalledPlugin>(`/api/plugins/${id}`);
        setPlugin(p);
        setMcp((await api<McpInfo[]>("/api/plugins/mcp")).filter((m) => m.pluginId === id));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        setPlugin(null);
        const cat = await api<CatalogEntry[]>("/api/plugins/catalog");
        setEntry(cat.find((c) => c.id === id) ?? null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (p: { enabled?: boolean; trusted?: boolean }) => {
    setBusy(true);
    try {
      await api(`/api/plugins/${id}`, { method: "PATCH", json: p });
      await refresh();
      await loadProviders().catch(() => {});
      await load();
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Page className="max-w-[880px]">
        <div className="flex gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-10 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
        <Skeleton className="mt-6 h-8 w-full" />
        <Skeleton className="mt-4 h-40 w-full" />
      </Page>
    );

  if (error)
    return (
      <Page className="max-w-[880px]">
        <ErrorState title="Couldn’t load this extension" error={`${error}. Check that REX is running, then retry.`} onRetry={() => (setLoading(true), void load())} />
      </Page>
    );

  if (!plugin) {
    if (!entry)
      return (
        <Page className="max-w-[880px]">
          <EmptyState icon={PackageX} title="Extension not found" hint={`“${id}” isn’t installed and isn’t in any marketplace.`} action={{ label: "Close", onClick: () => closeTab(`extension:${id}`) }} />
        </Page>
      );
    return (
      <Page className="max-w-[880px]">
        <Header
          icon={entry.icon}
          name={entry.name}
          author={entry.author}
          version={entry.version}
          description={entry.description}
          meta={<span className="truncate" title={entry.registry ?? entry.source}>from {entry.registry ?? entry.source}</span>}
          actions={
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await install(entry.source);
                await loadProviders().catch(() => {});
                setBusy(false);
                setLoading(true);
                await load();
              }}
            >
              <Download size={12} aria-hidden /> {busy ? "Installing…" : "Install"}
            </button>
          }
        />
        {entry.hasCode && <CodeWarning />}
        <Overview description={entry.description} categories={entry.categories} rows={[["Version", entry.version], ["Author", entry.author], ["Source", entry.source]]} />
      </Page>
    );
  }

  const m = plugin.manifest;
  const c = m.contributes;
  const settingsMissing = c.settings.filter((s) => s.secret && !plugin.configured.includes(s.key));
  const featureCount =
    c.themes.length + c.connections.length + c.agents.length + c.departments.length + Object.keys(c.mcpServers).length + c.commands.length + c.pipelines.length + (m.main ? 1 : 0);
  const tabs: { value: Section; label: string; badge?: React.ReactNode }[] = [
    { value: "features", label: "Features", badge: <span className="count">{featureCount}</span> },
    ...(c.settings.length ? [{ value: "settings" as const, label: "Settings", badge: settingsMissing.length ? <span className="count">{settingsMissing.length}</span> : undefined }] : []),
    { value: "overview", label: "Details" },
  ];
  const current: Section = tabs.some((t) => t.value === section) ? section : "features";

  const uninstall = async () => {
    if (!(await confirmDialog({ title: `Uninstall ${m.name}?`, message: "Its departments, commands, agents and settings are removed.", confirmLabel: "Uninstall", danger: true }))) return;
    try {
      await api(`/api/plugins/${id}`, { method: "DELETE" });
      await refresh();
      await loadProviders().catch(() => {});
      closeTab(`extension:${id}`);
      log("ok", "extensions", `Uninstalled ${m.name}`);
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Page className="max-w-[880px]">
      <Header
        icon={m.icon}
        name={m.name}
        author={m.author}
        version={m.version}
        description={m.description}
        status={plugin.error ? <Pill tone="err">Error</Pill> : plugin.enabled ? <Pill tone="ok">Enabled</Pill> : <Pill>Disabled</Pill>}
        actions={
          <>
            {plugin.hasCode &&
              (plugin.trusted ? (
                <button className="btn btn-sm" disabled={busy} onClick={() => void patch({ trusted: false })} title="Stop running this extension’s code">
                  <ShieldCheck size={12} className="text-ok" aria-hidden /> Revoke trust
                </button>
              ) : (
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirmDialog({ title: `Trust "${m.name}"?`, message: `Its code (${m.main}) will run inside the REX server with your user's permissions.`, confirmLabel: "Trust and activate", danger: true })) await patch({ trusted: true });
                  }}
                >
                  <ShieldAlert size={12} className="text-warn" aria-hidden /> Trust code
                </button>
              ))}
            <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => void uninstall()}>
              <Trash2 size={12} aria-hidden /> Uninstall
            </button>
            <label className="ml-1 flex items-center gap-2 text-[12px] text-muted">
              <Switch checked={plugin.enabled} disabled={busy} label={plugin.enabled ? `Disable ${m.name}` : `Enable ${m.name}`} onChange={(v) => void patch({ enabled: v })} />
              {plugin.enabled ? "On" : "Off"}
            </label>
          </>
        }
      />

      <div className="space-y-2">
        {plugin.error && <Notice tone="err">{plugin.error}</Notice>}
        {plugin.hasCode && !plugin.trusted && <CodeWarning />}
        {settingsMissing.length > 0 && plugin.enabled && (
          <Notice tone="warn">
            Add {settingsMissing.map((s) => s.title).join(", ")} in{" "}
            <button className="underline" onClick={() => setSection("settings")}>
              Settings
            </button>{" "}
            to activate this extension.
          </Notice>
        )}
      </div>

      <Tabs label="Extension sections" idPrefix={`ext-${id}`} value={current} onChange={setSection} tabs={tabs} className="mb-4 mt-3" />

      <div role="tabpanel" aria-labelledby={`ext-${id}-${current}`} className="space-y-4">
        {current === "overview" && (
          <Overview
            description={m.description}
            categories={m.categories}
            rows={[
              ["Version", m.version],
              ["Author", m.author],
              ["Source", plugin.source],
              ["Installed", new Date(plugin.installedAt).toLocaleDateString()],
              ...(m.homepage ? [["Homepage", m.homepage] as [string, string]] : []),
            ]}
          />
        )}

        {current === "settings" && (
          <Card title="Settings">
            <div className="divide-y divide-line">
              {c.settings.map((s) => (
                <SettingRow key={s.key} pluginId={id} setting={s} configured={plugin.configured.includes(s.key)} onSaved={load} />
              ))}
            </div>
          </Card>
        )}

        {current === "features" && (
          <>
            {featureCount === 0 && <EmptyState compact icon={Plug} title="No features listed" hint="This extension doesn’t add themes, tools, agents or commands." />}

            {c.themes.length > 0 && (
              <Card title="Color themes" count={c.themes.length} action={<button className="btn btn-sm" onClick={openThemePicker}>Browse color themes…</button>}>
                <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
                  {c.themes.map((t) => {
                    const choice = choiceOf({ ...t, pluginId: id });
                    const active = plugin.enabled && colorTheme === t.id;
                    return (
                      <li key={t.id} className={`rounded-[6px] border p-2 ${active ? "border-accent" : "border-line"}`}>
                        <ThemePreview colors={choice.colors} className="h-20 w-full" />
                        <div className="mt-2 flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium" title={t.label}>{t.label}</div>
                            <div className="text-[11px] text-faint">{t.kind === "light" ? "Light" : "Dark"}</div>
                          </div>
                          {active ? (
                            <Pill tone="accent" icon={Check}>
                              Active
                            </Pill>
                          ) : (
                            <button className="btn btn-sm" disabled={!plugin.enabled} title={plugin.enabled ? `Use ${t.label}` : "Enable the extension first"} onClick={() => applyThemeChoice(t.id)}>
                              Apply
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {c.connections.length > 0 && (
              <Card title="Connections" count={c.connections.length}>
                <Rows>
                  {c.connections.map((x) => (
                    <Row key={x.id} icon={<DeptIcon name={x.icon} size={14} />} title={x.name} sub={x.description}>
                      {plugin.enabled && (
                        <button className="btn btn-sm" onClick={() => openTab({ kind: "connections" }, "Connections")}>
                          Set up
                        </button>
                      )}
                    </Row>
                  ))}
                </Rows>
              </Card>
            )}

            {c.agents.length > 0 && (
              <Card title="Agents" count={c.agents.length}>
                <Rows>
                  {c.agents.map((a) => {
                    const status = agents.find(a.id);
                    const detail = status ? status.detail : plugin.enabled ? "Checking…" : "Enable the extension to use this agent";
                    return (
                      <Row key={a.id} icon={<DeptIcon name={a.icon} size={14} />} title={a.name} sub={a.description} meta={detail}>
                        {plugin.enabled && status && !status.available && a.install && (
                          <button className="btn btn-sm" onClick={() => launchTerminal({ id: a.id, action: "install" })} title={a.install}>
                            <Download size={12} aria-hidden /> Install
                          </button>
                        )}
                        {plugin.enabled && status?.available && a.login && (
                          <button className="btn btn-sm" onClick={() => launchTerminal({ id: a.id, action: "login" })} title={a.login}>
                            Sign in
                          </button>
                        )}
                      </Row>
                    );
                  })}
                </Rows>
              </Card>
            )}

            {c.departments.length > 0 && (
              <Card title="Departments" count={c.departments.length}>
                <Rows>
                  {c.departments.map((d) => (
                    <Row key={d.id} icon={<DeptIcon name={d.icon} color={d.color} size={14} />} title={d.name} sub={`${d.role} · default agent ${agents.label(d.defaultProvider)}`}>
                      {plugin.enabled && (
                        <button className="btn btn-sm" onClick={() => delegate({ department: d.id, brief: "" })}>
                          New task
                        </button>
                      )}
                    </Row>
                  ))}
                </Rows>
              </Card>
            )}

            {Object.keys(c.mcpServers).length > 0 && (
              <Card title="Tools for agents" count={Object.keys(c.mcpServers).length}>
                <Rows>
                  {Object.entries(c.mcpServers).map(([name, s]) => {
                    const info = mcp.find((x) => x.name === name);
                    const ready = plugin.enabled && info && info.missing.length === 0;
                    return (
                      <Row key={name} icon={<Plug size={14} className={ready ? "text-ok" : "text-faint"} />} title={name} mono={`${s.command} ${s.args.join(" ")}`}>
                        <Pill tone={!plugin.enabled ? "neutral" : ready ? "ok" : "warn"} title={!plugin.enabled || ready ? undefined : `Needs ${info?.missing.join(", ")}`}>
                          {!plugin.enabled ? "Disabled" : ready ? "Active" : "Setup needed"}
                        </Pill>
                      </Row>
                    );
                  })}
                </Rows>
              </Card>
            )}

            {c.commands.length > 0 && (
              <Card title="Commands" count={c.commands.length}>
                <Rows>
                  {c.commands.map((cmd) => (
                    <Row key={cmd.id} title={cmd.title} meta={cmd.department}>
                      {plugin.enabled && (
                        <button className="btn btn-sm" onClick={() => delegate({ department: cmd.department, brief: cmd.prompt })}>
                          Run
                        </button>
                      )}
                    </Row>
                  ))}
                </Rows>
              </Card>
            )}

            {c.pipelines.length > 0 && (
              <Card title="Create Studio presets" count={c.pipelines.length}>
                <Rows>
                  {c.pipelines.map((p) => (
                    <Row key={p.id} title={p.title} sub={p.description} meta={p.kind} />
                  ))}
                </Rows>
              </Card>
            )}

            {m.main && (
              <Card title="Code">
                <p className="text-[12px] text-muted">
                  Entry <code>{m.main}</code> registers media providers (voices and images) once trusted. They appear in Create Studio.
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

function Header(props: { icon: string; name: string; author: string; version: string; description: string; status?: React.ReactNode; meta?: React.ReactNode; actions: React.ReactNode }) {
  return (
    <header className="page-head flex-wrap">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] border border-line bg-elev text-muted" aria-hidden>
        <DeptIcon name={props.icon} size={20} />
      </span>
      <div className="page-head-main">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="page-title truncate" title={props.name}>
            {props.name}
          </h1>
          {props.status}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-muted">
          {props.author && <span className="truncate">{props.author}</span>}
          <Pill>v{props.version}</Pill>
          {props.meta}
        </div>
        {props.description && <p className="page-desc">{props.description}</p>}
      </div>
      <div className="page-actions">{props.actions}</div>
    </header>
  );
}

function Overview({ description, categories, rows }: { description: string; categories: string[]; rows: [string, string][] }) {
  return (
    <div className="space-y-4">
      {description && (
        <section className="card card-body">
          <Markdown text={description} />
        </section>
      )}
      <section className="card">
        <div className="card-head">Details</div>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-3 text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate font-mono text-[12px]" title={v}>
                {/^https?:\/\//.test(v) ? (
                  <a className="text-accent underline" href={v} target="_blank" rel="noreferrer">
                    {v} <ExternalLink size={11} className="inline" aria-hidden />
                  </a>
                ) : (
                  v || "—"
                )}
              </dd>
            </div>
          ))}
          {categories.length > 0 && (
            <div className="contents">
              <dt className="text-muted">Categories</dt>
              <dd className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <Pill key={c}>{c}</Pill>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}

function Card({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card @container">
      <div className="card-head">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {count !== undefined && <span className="count">{count}</span>}
        <div className="flex-1" />
        {action}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="-mx-3 -my-3 divide-y divide-line">{children}</ul>;
}

function Row({ icon, title, sub, meta, mono, children }: { icon?: React.ReactNode; title: string; sub?: string; meta?: string; mono?: string; children?: React.ReactNode }) {
  return (
    <li className="flex min-h-10 min-w-0 items-center gap-2.5 px-3 py-1.5">
      {icon && (
        <span className="grid h-6 w-6 shrink-0 place-items-center text-muted" aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium" title={title}>
            {title}
          </span>
          {meta && (
            <span className="truncate text-[11px] text-faint" title={meta}>
              {meta}
            </span>
          )}
        </div>
        {sub && (
          <div className="truncate text-[12px] text-muted" title={sub}>
            {sub}
          </div>
        )}
        {mono && (
          <div className="truncate font-mono text-[11px] text-muted" title={mono}>
            {mono}
          </div>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </li>
  );
}

function Notice({ tone, children }: { tone: "warn" | "err"; children: React.ReactNode }) {
  const color = tone === "err" ? "var(--err)" : "var(--warn)";
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className="flex gap-2 rounded-[6px] border px-3 py-2 text-[12px] leading-relaxed text-fg"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <ShieldAlert size={14} className={`mt-0.5 shrink-0 ${tone === "err" ? "text-err" : "text-warn"}`} aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function CodeWarning() {
  return (
    <Notice tone="warn">
      This extension ships code that runs inside the REX server with your permissions. It stays inactive until you choose Trust code. Only trust code you have reviewed or whose author you trust.
    </Notice>
  );
}

function SettingRow({ pluginId, setting, configured, onSaved }: { pluginId: string; setting: { key: string; title: string; description: string; secret: boolean }; configured: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const { log } = useWorkbench();
  const save = async () => {
    try {
      await api(`/api/plugins/${pluginId}/settings`, { method: "PUT", json: { key: setting.key, value } });
      setValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    }
  };
  const fid = `ext-set-${pluginId}-${setting.key}`;
  return (
    <div className="field py-3 first:pt-0 last:pb-0">
      <label htmlFor={fid} className="label flex items-center gap-2">
        {setting.title}
        <code className="text-[11px] font-normal text-faint">{setting.key}</code>
        {configured && (
          <Pill tone="ok" icon={Check}>
            Set
          </Pill>
        )}
      </label>
      <div className="flex max-w-[520px] gap-1.5">
        <input
          id={fid}
          className="input"
          type={setting.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={configured ? "•••••••• (enter to replace)" : "Not set"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button className="btn shrink-0" onClick={() => void save()} disabled={!value}>
          {saved ? <Check size={13} aria-label="Saved" /> : "Save"}
        </button>
      </div>
      {setting.description && <p className="help">{setting.description}</p>}
    </div>
  );
}

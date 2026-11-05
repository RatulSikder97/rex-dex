"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Plug, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { ApiError, api } from "@/lib/client";
import type { CatalogEntry, InstalledPlugin } from "@/lib/plugins/types";
import { DeptIcon } from "@/components/icons";
import { confirmDialog } from "@/components/ui/dialog";
import { useExtensionActions } from "@/components/sidebar/ExtensionsPanel";
import { useAgents, useWorkbench } from "@/store/workbench";
import { useSetting } from "@/store/settings";
import { ThemePreview, applyThemeChoice, choiceOf, openThemePicker } from "@/components/workbench/ThemePicker";

interface McpInfo {
  name: string;
  pluginId: string;
  command: string;
  args: string[];
  envKeys: string[];
  missing: string[];
}

export default function ExtensionDetail({ id }: { id: string }) {
  const { log, closeTab, delegate, launchTerminal, loadProviders, openTab } = useWorkbench();
  const { install, refresh } = useExtensionActions();
  const agents = useAgents();
  const colorTheme = useSetting<string>("appearance.colorTheme");
  const [plugin, setPlugin] = useState<InstalledPlugin | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [mcp, setMcp] = useState<McpInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api<InstalledPlugin>(`/api/plugins/${id}`);
      setPlugin(p);
      setMcp((await api<McpInfo[]>("/api/plugins/mcp")).filter((m) => m.pluginId === id));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      setPlugin(null);
      const cat = await api<CatalogEntry[]>("/api/plugins/catalog");
      setEntry(cat.find((c) => c.id === id) ?? null);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    load().catch((e) => log("error", "extensions", String(e)));
  }, [load, log]);

  const patch = async (p: { enabled?: boolean; trusted?: boolean }) => {
    setBusy(true);
    try {
      await api(`/api/plugins/${id}`, { method: "PATCH", json: p });
      await refresh();
      await loadProviders().catch(() => {});
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6 text-muted">Loading…</div>;

  if (!plugin) {
    if (!entry) return <div className="p-6 text-muted">Extension “{id}” was not found in any marketplace.</div>;
    return (
      <Shell icon={entry.icon} name={entry.name} author={entry.author} version={entry.version} categories={entry.categories} description={entry.description}>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary"
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
            <Download size={13} /> {busy ? "Installing…" : "Install"}
          </button>
          <span className="text-[11.5px] text-faint">from {entry.registry ?? entry.source}</span>
        </div>
        {entry.hasCode && <CodeWarning />}
      </Shell>
    );
  }

  const m = plugin.manifest;
  const c = m.contributes;
  const settingsMissing = c.settings.filter((s) => s.secret && !plugin.configured.includes(s.key));

  return (
    <Shell icon={m.icon} name={m.name} author={m.author} version={m.version} categories={m.categories} description={m.description}>
      <div className="flex flex-wrap items-center gap-2">
        {plugin.enabled ? (
          <button className="btn" disabled={busy} onClick={() => patch({ enabled: false })}>
            Disable
          </button>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={() => patch({ enabled: true })}>
            Enable
          </button>
        )}
        {plugin.hasCode &&
          (plugin.trusted ? (
            <button className="btn" disabled={busy} onClick={() => patch({ trusted: false })}>
              <ShieldCheck size={13} className="text-ok" /> Trusted (revoke)
            </button>
          ) : (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog({ title: `Trust "${m.name}"?`, message: `Its code (${m.main}) will run inside the REX server with your user's permissions.`, confirmLabel: "Trust & activate", danger: true })) await patch({ trusted: true });
              }}
            >
              <ShieldAlert size={13} className="text-warn" /> Trust & activate code
            </button>
          ))}
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!(await confirmDialog({ title: `Uninstall ${m.name}?`, message: "Its departments, commands, agents and settings are removed.", confirmLabel: "Uninstall", danger: true }))) return;
            await api(`/api/plugins/${id}`, { method: "DELETE" });
            await refresh();
            await loadProviders().catch(() => {});
            closeTab(`extension:${id}`);
            log("ok", "extensions", `Uninstalled ${m.name}`);
          }}
        >
          <Trash2 size={13} /> Uninstall
        </button>
        <span className="text-[11.5px] text-faint">
          {plugin.enabled ? "Enabled" : "Disabled"} · source {plugin.source}
        </span>
      </div>

      {plugin.error && <div className="rounded border border-err/40 bg-err/10 px-3 py-2 text-[12px] text-err">{plugin.error}</div>}
      {plugin.hasCode && !plugin.trusted && <CodeWarning />}
      {settingsMissing.length > 0 && plugin.enabled && (
        <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">Configure {settingsMissing.map((s) => s.title).join(", ")} below to activate this extension.</div>
      )}

      {(c.themes ?? []).length > 0 && (
        <Card title={`Color themes (${c.themes.length})`}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {c.themes.map((t) => {
              const choice = choiceOf({ ...t, pluginId: id });
              const active = plugin.enabled && colorTheme === t.id;
              return (
                <li key={t.id} className={`rounded-lg border p-2 ${active ? "border-accent" : "border-line"}`}>
                  <ThemePreview colors={choice.colors} className="h-20 w-full" />
                  <div className="mt-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{t.label}</div>
                      <div className="text-[11px] text-faint">{t.kind === "light" ? "Light" : "Dark"}</div>
                    </div>
                    {active ? (
                      <span className="flex items-center gap-1 text-[11.5px] text-accent">
                        <Check size={12} /> Active
                      </span>
                    ) : (
                      <button className="btn" disabled={!plugin.enabled} title={plugin.enabled ? undefined : "Enable the extension first"} onClick={() => applyThemeChoice(t.id)}>
                        Apply
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <button className="btn mt-3" onClick={openThemePicker}>
            Color Theme picker…
          </button>
        </Card>
      )}

      {c.settings.length > 0 && (
        <Card title="Settings">
          {c.settings.map((s) => (
            <SettingRow key={s.key} pluginId={id} setting={s} configured={plugin.configured.includes(s.key)} onSaved={load} />
          ))}
        </Card>
      )}

      {c.connections.length > 0 && (
        <Card title="Connections">
          {c.connections.map((x) => (
            <div key={x.id} className="flex items-start gap-3 py-1.5">
              <DeptIcon name={x.icon} size={16} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{x.name}</div>
                <div className="text-[11.5px] text-muted">{x.description}</div>
              </div>
              {plugin.enabled && (
                <button className="btn" onClick={() => openTab({ kind: "connections" }, "Connections")}>
                  Set up
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {c.agents.length > 0 && (
        <Card title="Terminal agents">
          {c.agents.map((a) => {
            const status = agents.find(a.id);
            return (
              <div key={a.id} className="flex items-start gap-3 py-1.5">
                <DeptIcon name={a.icon} size={16} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{a.name}</div>
                  <div className="text-[11.5px] text-muted">{a.description}</div>
                  <div className="truncate font-mono text-[11px] text-faint">
                    {status ? status.detail : plugin.enabled ? "checking…" : "enable the extension to use this agent"}
                  </div>
                </div>
                {plugin.enabled && status && !status.available && a.install && (
                  <button className="btn btn-primary" onClick={() => launchTerminal({ id: a.id, action: "install" })} title={a.install}>
                    <Download size={13} /> Install
                  </button>
                )}
                {plugin.enabled && status?.available && a.login && (
                  <button className="btn" onClick={() => launchTerminal({ id: a.id, action: "login" })} title={a.login}>
                    Sign in
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {c.departments.length > 0 && (
        <Card title="Departments">
          {c.departments.map((d) => (
            <div key={d.id} className="flex items-start gap-3 py-1.5">
              <DeptIcon name={d.icon} color={d.color} size={16} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{d.name}</div>
                <div className="text-[11.5px] text-muted">
                  {d.role} · default agent {agents.label(d.defaultProvider)}
                </div>
              </div>
              {plugin.enabled && (
                <button className="btn" onClick={() => delegate({ department: d.id, brief: "" })}>
                  Open in Agent
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {Object.keys(c.mcpServers).length > 0 && (
        <Card title="MCP servers (tools for Claude Code & Codex agents)">
          {Object.entries(c.mcpServers).map(([name, s]) => {
            const info = mcp.find((x) => x.name === name);
            const ready = plugin.enabled && info && info.missing.length === 0;
            return (
              <div key={name} className="flex items-start gap-3 py-1.5">
                <Plug size={15} className={ready ? "text-ok" : "text-faint"} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{name}</div>
                  <div className="truncate font-mono text-[11px] text-muted">
                    {s.command} {s.args.join(" ")}
                  </div>
                </div>
                <span className={`text-[11px] ${ready ? "text-ok" : "text-warn"}`}>
                  {!plugin.enabled ? "disabled" : ready ? "active in CLI agents" : `needs ${info?.missing.join(", ")}`}
                </span>
              </div>
            );
          })}
        </Card>
      )}

      {c.commands.length > 0 && (
        <Card title="Commands (⌘K)">
          {c.commands.map((cmd) => (
            <div key={cmd.id} className="flex items-center gap-3 py-1">
              <span className="text-[12.5px]">{cmd.title}</span>
              <span className="text-[11px] text-faint">→ {cmd.department}</span>
              <div className="flex-1" />
              {plugin.enabled && (
                <button className="btn" onClick={() => delegate({ department: cmd.department, brief: cmd.prompt })}>
                  Run
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {c.pipelines.length > 0 && (
        <Card title="Create Studio presets">
          {c.pipelines.map((p) => (
            <div key={p.id} className="py-1">
              <div className="text-[12.5px]">
                {p.title} <span className="text-[11px] text-faint">· {p.kind}</span>
              </div>
              {p.description && <div className="text-[11.5px] text-muted">{p.description}</div>}
            </div>
          ))}
        </Card>
      )}

      {m.main && (
        <Card title="Code">
          <p className="text-[12px] text-muted">
            Entry <code>{m.main}</code> registers media providers (voices/images) when trusted. Providers appear in Create Studio.
          </p>
        </Card>
      )}
    </Shell>
  );
}

function Shell(props: { icon: string; name: string; author: string; version: string; categories: string[]; description: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        <div className="flex gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-elev">
            <DeptIcon name={props.icon} size={40} />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold">{props.name}</h1>
            <div className="text-[12px] text-muted">
              {props.author} · v{props.version}
            </div>
            <p className="text-[13px] leading-relaxed">{props.description}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              {props.categories.map((c) => (
                <span key={c} className="rounded bg-elev px-1.5 py-0.5 text-[10.5px] text-muted">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="section-title mb-2">{title}</div>
      {children}
    </section>
  );
}

function CodeWarning() {
  return (
    <div className="flex gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
      <span>This extension ships code that runs inside the REX server with your permissions. It stays inactive until you choose “Trust & activate code”. Only trust code you have reviewed or whose author you trust.</span>
    </div>
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
      log("error", "extensions", String(e));
    }
  };
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium">{setting.title}</span>
        <code className="text-[10.5px] text-faint">{setting.key}</code>
        {configured && (
          <span className="flex items-center gap-0.5 text-[11px] text-ok">
            <Check size={11} /> set
          </span>
        )}
      </div>
      {setting.description && <div className="text-[11.5px] text-muted">{setting.description}</div>}
      <div className="flex gap-2">
        <input
          className="input"
          type={setting.secret ? "password" : "text"}
          autoComplete="off"
          placeholder={configured ? "•••••••• (enter to replace)" : "Not set"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="btn" onClick={save}>
          {saved ? <Check size={13} /> : "Save"}
        </button>
      </div>
    </div>
  );
}

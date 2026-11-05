"use client";
import { useEffect, useState } from "react";
import { Blocks, Bot, Download, ExternalLink, LogIn, RefreshCw, SquareTerminal, Star } from "lucide-react";
import { api } from "@/lib/client";
import type { ProviderStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useAgents, useDepartments, useWorkbench } from "@/store/workbench";
import { ErrorState, LoadingRows, Pill } from "@/components/ui/kit";
import { EmptyState } from "@/components/ui/empty";

/**
 * Agent-related settings sections (lead-owned; moved verbatim from SettingsView).
 * Section ids settings-agents / settings-departments / settings-registries are scroll anchors for openSettings().
 */

export function Card({ id, title, description, action, children }: { id: string; title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-4" aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <h2 id={`${id}-h`} className="min-w-0 flex-1 truncate">
          {title}
        </h2>
        {action}
      </div>
      {description && <p className="px-3 pt-2.5 text-[12px] leading-relaxed text-muted">{description}</p>}
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- agents

export function AgentsCard() {
  const { agents, prefs } = useAgents();
  const { saveAgentPrefs, launchTerminal, setActivity, log } = useWorkbench();
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      const fresh = await api<ProviderStatus[]>("/api/agents?refresh=1");
      useWorkbench.setState({ providers: fresh });
      log("ok", "agents", `${fresh.filter((a) => a.available).length} of ${fresh.length} agents installed`);
    } catch (e) {
      log("error", "agents", e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const save = (p: Parameters<typeof saveAgentPrefs>[0]) => saveAgentPrefs(p).catch((e) => log("error", "agents", e instanceof Error ? e.message : String(e)));

  return (
    <Card
      id="settings-agents"
      title="Installed agents"
      description="Each agent is a CLI on your machine. REX runs it in the background for department work, and you can open it in the integrated terminal. Install and sign-in run in the terminal with the CLI’s own login."
      action={
        <button className="btn btn-sm" onClick={() => void recheck()} disabled={checking} title="Look for installed agents again">
          <RefreshCw size={12} className={checking ? "animate-spin" : ""} /> {checking ? "Checking…" : "Re-check"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor="settings-default-agent" className="text-[13px] font-semibold">
          Default agent
        </label>
        <select id="settings-default-agent" className="input !w-56 max-w-full" value={prefs.defaultAgent} onChange={(e) => void save({ defaultAgent: e.target.value })}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.available ? "" : " (not installed)"}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-muted">Used by departments without their own choice.</span>
      </div>

      {!agents.length ? (
        <div className="rounded-[6px] border border-line">
          <EmptyState compact icon={Bot} title="No agents found" hint="Install Claude Code or Codex, then choose Re-check." action={{ label: "Re-check", onClick: () => void recheck() }} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[6px] border border-line bg-editor" aria-label="Agents">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="flex min-w-[220px] flex-1 items-start gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border border-line bg-elev" aria-hidden>
                  <DeptIcon name={a.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold">{a.label}</span>
                    {a.available ? <Pill tone="ok">Installed</Pill> : <Pill tone="err">Not installed</Pill>}
                    {a.authError && (
                      <Pill tone="warn" title={a.authError}>
                        Sign-in expired
                      </Pill>
                    )}
                    {prefs.defaultAgent === a.id && (
                      <Pill tone="accent" icon={Star}>
                        Default
                      </Pill>
                    )}
                    <span className="text-[11px] text-faint">{a.builtin ? "Built-in" : `Extension · ${a.pluginId}`}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{a.description}</div>
                  <div className="truncate font-mono text-[11px] text-faint" title={a.detail}>
                    {a.detail}
                  </div>
                  {a.authError && <div className="mt-0.5 text-[11px] text-warn">Other agents run its work until you sign in again.</div>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {a.models.length > 0 && (
                  <select
                    className="input input-sm !w-auto max-w-[180px]"
                    value={prefs.models[a.id] ?? ""}
                    onChange={(e) => void save({ models: { ...prefs.models, [a.id]: e.target.value } })}
                    aria-label={`${a.label} model`}
                    title="Default model"
                  >
                    <option value="">Default model</option>
                    {a.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                {!a.available && a.install && (
                  <button className="btn btn-sm" onClick={() => launchTerminal({ id: a.id, action: "install" })} title={a.install}>
                    <Download size={12} /> Install
                  </button>
                )}
                {a.login && (
                  <button className={`btn btn-sm ${a.authError ? "btn-primary" : ""}`} disabled={!a.available} onClick={() => launchTerminal({ id: a.id, action: "login" })} title={a.login}>
                    <LogIn size={12} /> Sign in
                  </button>
                )}
                {a.interactive && (
                  <button className="icon-btn" disabled={!a.available} onClick={() => launchTerminal({ id: a.id, action: "interactive" })} aria-label={`Open ${a.label} in terminal`} title="Open in terminal">
                    <SquareTerminal size={13} />
                  </button>
                )}
                {prefs.defaultAgent !== a.id && (
                  <button className="icon-btn" disabled={!a.available} onClick={() => void save({ defaultAgent: a.id })} aria-label={`Make ${a.label} the default agent`} title="Make default">
                    <Star size={13} />
                  </button>
                )}
                {a.homepage && (
                  <a className="icon-btn" href={a.homepage} target="_blank" rel="noreferrer" title="Open docs" aria-label={`${a.label} docs`}>
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-sm" onClick={() => setActivity("extensions")} title="Cursor, Gemini, Ollama, Copilot and more">
        <Blocks size={13} /> Get more agents
      </button>
    </Card>
  );
}

// ---------------------------------------------------------------- departments

export function DepartmentsCard() {
  const { departments } = useDepartments();
  const { agents, prefs, label } = useAgents();
  const { saveAgentPrefs, log } = useWorkbench();
  const setDept = (deptId: string, agentId: string) =>
    saveAgentPrefs({ departments: { ...prefs.departments, [deptId]: agentId } }).catch((e) => log("error", "agents", e instanceof Error ? e.message : String(e)));
  return (
    <Card
      id="settings-departments"
      title="Department agents"
      description="Choose which agent each department runs on. “Department default” uses the department’s recommended agent if it’s installed, otherwise your default agent."
    >
      <div className="overflow-x-auto rounded-[6px] border border-line bg-editor">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col" className="w-[45%]">
                Agent
              </th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => {
              const sub = `${d.role}${d.usesRepo ? " · works inside the project repo" : ""}`;
              return (
                <tr key={d.id}>
                  <td className="!h-auto py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <DeptIcon name={d.icon} color={d.color} size={14} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[13px]">
                          <span className="truncate">{d.name}</span>
                          {d.pluginId && <Pill>Extension</Pill>}
                        </div>
                        <div className="max-w-[360px] truncate text-[11px] text-muted" title={sub}>
                          {sub}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select className="input input-sm" value={prefs.departments[d.id] ?? ""} onChange={(e) => void setDept(d.id, e.target.value)} aria-label={`${d.name} agent`}>
                      <option value="">Department default ({label(d.defaultProvider)})</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.available}>
                          {a.label}
                          {a.available ? "" : " (not installed)"}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- registries

export function RegistriesCard() {
  const { log, bump } = useWorkbench();
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const load = () => {
    setState("loading");
    api<string[]>("/api/plugins/registries")
      .then((u) => {
        setText(u.join("\n"));
        setState("ready");
      })
      .catch((e) => {
        setError(e);
        setState("error");
      });
  };
  useEffect(load, []);
  const save = async () => {
    setSaving(true);
    try {
      const urls = text.split(/\s+/).map((u) => u.trim()).filter(Boolean);
      const saved = await api<string[]>("/api/plugins/registries", { method: "PUT", json: { urls } });
      setText(saved.join("\n"));
      bump();
      log("ok", "extensions", `Saved ${saved.length} marketplace registr${saved.length === 1 ? "y" : "ies"}`);
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card
      id="settings-registries"
      title="Extension marketplaces"
      description={
        <>
          Besides the built-in REX catalog, add HTTPS URLs of JSON indexes shaped like{" "}
          <code className="break-all font-mono text-[11px]">{`{"plugins":[{"id","name","description","author","version","icon","categories","hasCode","source":"<git url>"}]}`}</code>. One per line.
        </>
      }
    >
      {state === "loading" ? (
        <LoadingRows rows={1} height={68} />
      ) : state === "error" ? (
        <ErrorState compact title="Couldn’t load marketplace URLs" error={error} onRetry={load} />
      ) : (
        <>
          <label htmlFor="settings-registries-urls" className="sr-only">
            Marketplace URLs
          </label>
          <textarea id="settings-registries-urls" className="input font-mono !text-[11.5px]" rows={3} placeholder="https://example.com/rex-registry.json" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end">
            <button className="btn btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save marketplaces"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

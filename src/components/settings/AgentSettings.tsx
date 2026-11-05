"use client";
import { useEffect, useState } from "react";
import { Blocks, Download, ExternalLink, LogIn, RefreshCw, SquareTerminal, Star } from "lucide-react";
import { api } from "@/lib/client";
import type { ProviderStatus } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import { useAgents, useDepartments, useWorkbench } from "@/store/workbench";

/**
 * Agent-related settings sections (lead-owned; moved verbatim from SettingsView).
 * Section ids settings-agents / settings-departments / settings-registries are scroll anchors for openSettings().
 */

export function Card({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-4 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
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
      title="Agents"
      action={
        <button className="btn" onClick={() => void recheck()} disabled={checking}>
          <RefreshCw size={12} className={checking ? "animate-spin" : ""} /> Re-check
        </button>
      }
    >
      <p className="text-[12px] leading-relaxed text-muted">
        Each agent is a CLI on your machine. REX runs it non-interactively for department work, and you can open it interactively in the integrated terminal. Install and sign in happen in the terminal with the CLI&apos;s own login.
      </p>

      <div className="flex items-center gap-2">
        <span className="w-28 text-[12.5px]">Default agent</span>
        <select className="input w-56" value={prefs.defaultAgent} onChange={(e) => void save({ defaultAgent: e.target.value })} aria-label="Default agent">
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.available ? "" : " (not installed)"}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-faint">used by departments without their own choice</span>
      </div>

      <div className="divide-y divide-line rounded-md border border-line">
        {agents.map((a) => (
          <div key={a.id} className="flex gap-3 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-elev">
              <DeptIcon name={a.icon} size={18} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.label}</span>
                <span className="rounded bg-elev px-1.5 py-px text-[10.5px] text-muted">{a.builtin ? "built-in" : `extension · ${a.pluginId}`}</span>
                {prefs.defaultAgent === a.id && (
                  <span className="flex items-center gap-0.5 text-[10.5px] text-warn">
                    <Star size={10} /> default
                  </span>
                )}
                <span className={`flex items-center gap-1 text-[11px] ${a.available ? "text-ok" : "text-err"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${a.available ? "bg-ok" : "bg-err"}`} />
                  {a.available ? "installed" : "not installed"}
                </span>
                {a.authError && (
                  <span className="rounded bg-warn/15 px-1.5 py-px text-[10.5px] text-warn" title={a.authError}>
                    sign-in expired: other agents cover for it
                  </span>
                )}
              </div>
              <div className="text-[12px] text-muted">{a.description}</div>
              <div className="truncate font-mono text-[11px] text-faint" title={a.detail}>
                {a.detail}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {!a.available && a.install && (
                  <button className="btn btn-primary h-6" onClick={() => launchTerminal({ id: a.id, action: "install" })} title={a.install}>
                    <Download size={12} /> Install in terminal
                  </button>
                )}
                {a.login && (
                  <button className={`btn h-6 ${a.authError ? "btn-primary" : ""}`} disabled={!a.available} onClick={() => launchTerminal({ id: a.id, action: "login" })} title={a.login}>
                    <LogIn size={12} /> Sign in
                  </button>
                )}
                {a.interactive && (
                  <button className="btn h-6" disabled={!a.available} onClick={() => launchTerminal({ id: a.id, action: "interactive" })}>
                    <SquareTerminal size={12} /> Open in terminal
                  </button>
                )}
                {prefs.defaultAgent !== a.id && (
                  <button className="btn h-6" disabled={!a.available} onClick={() => void save({ defaultAgent: a.id })}>
                    <Star size={12} /> Make default
                  </button>
                )}
                {a.models.length > 0 && (
                  <select
                    className="input h-6 w-auto text-[11.5px]"
                    value={prefs.models[a.id] ?? ""}
                    onChange={(e) => void save({ models: { ...prefs.models, [a.id]: e.target.value } })}
                    aria-label={`${a.label} model`}
                    title="Default model"
                  >
                    <option value="">default model</option>
                    {a.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                {a.homepage && (
                  <a className="icon-btn" href={a.homepage} target="_blank" rel="noreferrer" title="Docs" aria-label={`${a.label} docs`}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="btn" onClick={() => setActivity("extensions")}>
        <Blocks size={13} /> Get more agents from Extensions (Cursor, Gemini, Ollama, Copilot…)
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
    <Card id="settings-departments" title="Departments">
      <p className="text-[12px] text-muted">Choose which agent each department runs on. “Department default” uses the department&apos;s recommended agent if it&apos;s installed, else your default agent.</p>
      <div className="divide-y divide-line rounded-md border border-line">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
            <DeptIcon name={d.icon} color={d.color} size={14} />
            <div className="min-w-0 flex-1">
              <div>
                {d.name}
                {d.pluginId && <span className="ml-1.5 text-[10.5px] text-faint">extension</span>}
              </div>
              <div className="truncate text-[11px] text-muted">
                {d.role}
                {d.usesRepo ? " · works inside the project repo" : ""}
              </div>
            </div>
            <select className="input h-7 w-52 text-[12px]" value={prefs.departments[d.id] ?? ""} onChange={(e) => void setDept(d.id, e.target.value)} aria-label={`${d.name} agent`}>
              <option value="">Department default ({label(d.defaultProvider)})</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.available}>
                  {a.label}
                  {a.available ? "" : " (not installed)"}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- registries

export function RegistriesCard() {
  const { log, bump } = useWorkbench();
  const [text, setText] = useState("");
  useEffect(() => {
    api<string[]>("/api/plugins/registries").then((u) => setText(u.join("\n"))).catch(() => {});
  }, []);
  const save = async () => {
    try {
      const urls = text.split(/\s+/).map((u) => u.trim()).filter(Boolean);
      const saved = await api<string[]>("/api/plugins/registries", { method: "PUT", json: { urls } });
      setText(saved.join("\n"));
      bump();
      log("ok", "extensions", `Saved ${saved.length} marketplace registr${saved.length === 1 ? "y" : "ies"}`);
    } catch (e) {
      log("error", "extensions", e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card id="settings-registries" title="Extension marketplaces">
      <p className="text-[12px] leading-relaxed text-muted">
        Besides the built-in REX catalog, add HTTPS URLs to JSON indexes shaped like{" "}
        <code>{`{"plugins":[{"id","name","description","author","version","icon","categories","hasCode","source":"<git url>"}]}`}</code>. One per line.
      </p>
      <textarea className="input font-mono text-[11.5px]" rows={3} placeholder="https://example.com/rex-registry.json" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" onClick={() => void save()}>
        Save registries
      </button>
    </Card>
  );
}

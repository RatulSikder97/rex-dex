"use client";
import { useCallback, useState } from "react";
import { AlertTriangle, Box, Layers, Network, RotateCw, Scaling, ScrollText } from "lucide-react";
import { api } from "@/lib/client";
import type { K8sInfo } from "@/lib/opsTypes";
import { EmptyState } from "@/components/ui/empty";
import { confirmDialog, promptDialog } from "@/components/ui/dialog";
import { useWorkbench } from "@/store/workbench";
import { Card, ErrorBox, LoadingGrid, LogsDrawer, Pill, Spinner, Table, errMsg, useOpsFetch, type OpsNav, type Tone } from "./shared";

function phaseTone(phase: string): Tone {
  const p = phase.toLowerCase();
  if (p === "running") return "ok";
  if (p === "succeeded" || p === "completed") return "muted";
  if (p === "pending" || p === "containercreating") return "warn";
  return "err";
}

export default function K8sSection({ nav }: { nav: OpsNav }) {
  const log = useWorkbench((s) => s.log);
  const [sel, setSel] = useState<{ context: string; namespace: string }>({ context: "", namespace: "" });
  const qs = new URLSearchParams();
  if (sel.context) qs.set("context", sel.context);
  if (sel.namespace) qs.set("namespace", sel.namespace);
  const { data, error, loading, reload } = useOpsFetch<K8sInfo>(`/api/ops/k8s${qs.toString() ? `?${qs}` : ""}`, nav.reloadKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const context = sel.context || data?.current || "";
  const namespace = sel.namespace || data?.namespace || "default";

  const call = useCallback(
    (kind: "pod" | "deployment", name: string, action: "logs" | "restart" | "scale", replicas?: number) =>
      api<{ ok: true; output: string }>("/api/ops/k8s", { method: "POST", json: { context, namespace, kind, name, action, replicas } }),
    [context, namespace],
  );

  const restart = async (name: string) => {
    if (!(await confirmDialog({ title: `Rollout restart ${name}?`, message: `Recreates every pod of deployment ${name} in ${namespace} (${context}), one by one.`, confirmLabel: "Restart", danger: true }))) return;
    setBusy(`${name}:restart`);
    try {
      await call("deployment", name, "restart");
      log("ok", "k8s", `Restarting ${name}`);
      await reload();
    } catch (e) {
      log("error", "k8s", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const scale = async (name: string, desired: number) => {
    const v = await promptDialog({ title: `Scale ${name}`, message: `Replicas for ${name} in ${namespace}.`, initial: String(desired), confirmLabel: "Scale" });
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) return log("error", "k8s", "Replicas must be a whole number between 0 and 100");
    if (n === 0 && !(await confirmDialog({ title: `Scale ${name} to 0?`, message: "This takes the deployment offline.", confirmLabel: "Scale to 0", danger: true }))) return;
    setBusy(`${name}:scale`);
    try {
      await call("deployment", name, "scale", n);
      log("ok", "k8s", `Scaled ${name} to ${n}`);
      await reload();
    } catch (e) {
      log("error", "k8s", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const loadLogs = useCallback(async () => (logsFor ? (await call("pod", logsFor, "logs")).output ?? "" : ""), [call, logsFor]);

  if (!data && error) return <ErrorBox title="Couldn't load Kubernetes" error={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingGrid n={3} />;

  const warnings = data.events.filter((e) => e.type !== "Normal");

  return (
    <div className="space-y-4" aria-busy={loading}>
      {(data.contexts.length > 0 || data.available) && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Context
            <select className="input input-sm w-52" value={context} onChange={(e) => setSel({ context: e.target.value, namespace: "" })} aria-label="Kubernetes context">
              {!data.contexts.length && <option value="">(none)</option>}
              {data.contexts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Namespace
            <select className="input input-sm w-40" value={namespace} onChange={(e) => setSel((s) => ({ context: s.context || context, namespace: e.target.value }))} aria-label="Namespace" disabled={!data.namespaces.length}>
              {!data.namespaces.includes(namespace) && <option value={namespace}>{namespace}</option>}
              {data.namespaces.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {loading && <Spinner />}
        </div>
      )}

      {!data.available && (
        <ErrorBox tone={data.contexts.length ? "err" : "warn"} title={data.contexts.length ? "Cluster unreachable" : "Kubernetes isn't set up"} error={data.error ?? "No Kubernetes context in your kubeconfig"} onRetry={() => void reload()}>
          {!data.contexts.length && "For a local cluster, turn on Kubernetes in Docker Desktop, or use kind or minikube."}
        </ErrorBox>
      )}

      {data.available && (
        <>
          <Card title="Pods" icon={<Box size={13} />} action={<Pill tone="muted">{data.pods.filter((p) => p.phase === "Running").length}/{data.pods.length} running</Pill>} flush={!!data.pods.length}>
            {data.pods.length ? (
              <Table label="Pods" head={["Name", "Phase", "Ready", "Restarts", "Age", "Node", ""]}>
                {data.pods.map((p) => (
                  <tr key={p.name}>
                    <td className="max-w-[260px] truncate font-mono text-[11.5px]" title={p.name}>
                      {p.name}
                    </td>
                    <td>
                      <Pill tone={phaseTone(p.phase)}>{p.phase}</Pill>
                    </td>
                    <td className="tabular-nums">{p.ready}</td>
                    <td className={`tabular-nums ${p.restarts > 5 ? "font-semibold text-err" : p.restarts > 0 ? "font-medium text-warn" : "text-muted"}`}>{p.restarts}</td>
                    <td className="text-muted">{p.age}</td>
                    <td className="max-w-[160px] truncate text-muted" title={p.node}>
                      {p.node}
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => setLogsFor(p.name)} aria-label={`Logs for ${p.name}`} title="Logs">
                        <ScrollText size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState compact icon={Box} title="No pods" hint={`Nothing is running in ${namespace}.`} />
            )}
          </Card>

          <Card title="Deployments" icon={<Layers size={13} />} action={<span className="count">{data.deployments.length}</span>} flush={!!data.deployments.length}>
            {data.deployments.length ? (
              <Table label="Deployments" head={["Name", "Ready", "Available", ""]}>
                {data.deployments.map((d) => (
                  <tr key={d.name}>
                    <td className="max-w-[240px] truncate font-medium" title={d.name}>
                      {d.name}
                    </td>
                    <td>
                      <Pill tone={d.ready >= d.desired ? (d.desired ? "ok" : "muted") : d.ready ? "warn" : "err"}>
                        {d.ready}/{d.desired}
                      </Pill>
                    </td>
                    <td className="tabular-nums text-muted">{d.available}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button className="btn btn-sm" disabled={!!busy} onClick={() => void scale(d.name, d.desired)}>
                          {busy === `${d.name}:scale` ? <Spinner /> : <Scaling size={12} />} Scale
                        </button>
                        <button className="btn btn-sm" disabled={!!busy} onClick={() => void restart(d.name)}>
                          {busy === `${d.name}:restart` ? <Spinner /> : <RotateCw size={12} />} Rollout restart
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-[12px] text-muted">No deployments in {namespace}.</p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
            <Card title="Services" icon={<Network size={13} />} action={<span className="count">{data.services.length}</span>}>
              {data.services.length ? (
                <ul className="space-y-1 text-[12px]">
                  {data.services.map((s) => (
                    <li key={s.name} className="flex flex-wrap items-center gap-x-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <Pill tone="muted">{s.type}</Pill>
                      <span className="font-mono text-[11px] text-muted">{s.clusterIp}</span>
                      <span className="w-full truncate pl-0 font-mono text-[11px] text-faint">{s.ports}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">No services in {namespace}.</p>
              )}
            </Card>
            <Card title="Warning events" icon={<AlertTriangle size={13} />} action={<span className="count">{warnings.length}</span>}>
              {warnings.length ? (
                <ul className="max-h-80 space-y-2 overflow-y-auto text-[12px]">
                  {warnings.slice(0, 30).map((e, i) => (
                    <li key={i}>
                      <div className="flex items-center gap-2">
                        <Pill tone="warn">{e.reason}</Pill>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={e.object}>
                          {e.object}
                        </span>
                        <span className="shrink-0 text-[11px] text-faint">{e.age}</span>
                      </div>
                      <p className="mt-0.5 break-words text-muted">{e.message}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">No warnings.</p>
              )}
            </Card>
          </div>
        </>
      )}

      {logsFor && <LogsDrawer title={`Logs · ${logsFor}`} load={loadLogs} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

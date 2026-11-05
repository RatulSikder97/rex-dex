"use client";
import { useCallback, useState } from "react";
import { Boxes, Layers, Play, RotateCw, ScrollText, Square } from "lucide-react";
import { api } from "@/lib/client";
import type { DockerInfo, ServerWithLast } from "@/lib/opsTypes";
import { EmptyState } from "@/components/ui/empty";
import { confirmDialog } from "@/components/ui/dialog";
import { useWorkbench } from "@/store/workbench";
import { Card, ErrorBox, LoadingGrid, LogsDrawer, Pill, Spinner, Table, errMsg, useOpsFetch, type OpsNav, type Tone } from "./shared";
import { serversUrl } from "./ServersSection";

type Action = "start" | "stop" | "restart" | "logs";

function stateTone(state: string, status: string): Tone {
  const s = state.toLowerCase();
  if (s === "running") return /unhealthy/i.test(status) ? "warn" : /starting/i.test(status) ? "accent" : "ok";
  if (s === "restarting" || s === "paused") return "warn";
  if (s === "exited" || s === "dead") return /exited \(0\)/i.test(status) ? "muted" : "err";
  return "muted";
}

export default function DockerSection({ nav }: { nav: OpsNav }) {
  const log = useWorkbench((s) => s.log);
  const { data: servers } = useOpsFetch<ServerWithLast[]>(serversUrl(nav.projectId), nav.reloadKey);
  const [target, setTarget] = useState<string>(""); // "" = this Mac
  const url = `/api/ops/docker${target ? `?serverId=${encodeURIComponent(target)}` : ""}`;
  const { data, error, loading, reload } = useOpsFetch<DockerInfo>(url, nav.reloadKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const call = useCallback((container: string, action: Action) => api<{ ok: true; output: string }>("/api/ops/docker", { method: "POST", json: { serverId: target || undefined, container, action } }), [target]);

  const act = async (container: string, action: Exclude<Action, "logs">) => {
    if (action !== "start" && !(await confirmDialog({ title: `${action === "stop" ? "Stop" : "Restart"} ${container}?`, message: `This ${action === "stop" ? "stops" : "restarts"} the container on ${data?.target ?? "this Mac"}. Anything it serves goes down ${action === "stop" ? "until you start it again" : "briefly"}.`, confirmLabel: action === "stop" ? "Stop" : "Restart", danger: true })))
      return;
    setBusy(`${container}:${action}`);
    try {
      await call(container, action);
      log("ok", "docker", `${action === "start" ? "Started" : action === "stop" ? "Stopped" : "Restarted"} ${container}`);
      await reload();
    } catch (e) {
      log("error", "docker", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const loadLogs = useCallback(async () => (logsFor ? (await call(logsFor, "logs")).output ?? "" : ""), [call, logsFor]);

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          Target
          <select className="input h-7 w-56" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Docker target">
            <option value="">This Mac</option>
            {servers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (SSH)
              </option>
            ))}
          </select>
        </label>
        {loading && data && <Spinner />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{data?.target}</span>
      </div>

      {!data && error && <ErrorBox title="Couldn't load Docker">{error}</ErrorBox>}
      {!data && !error && <LoadingGrid n={2} />}
      {data && !data.available && (
        <ErrorBox title="Docker isn't available">
          {data.error ?? "The docker CLI wasn't found or the daemon isn't running."}
          <div className="mt-1.5 text-[12px]">{target ? "Install Docker on the server and make sure the SSH user is in the docker group (sudo usermod -aG docker $USER)." : "Start Docker Desktop (or colima / OrbStack) and refresh."}</div>
        </ErrorBox>
      )}

      {data?.available && (
        <>
          <Card title={`Containers · ${data.containers.filter((c) => c.state === "running").length}/${data.containers.length} running`} icon={<Boxes size={14} />}>
            {data.containers.length ? (
              <Table label="Containers" head={["Container", "State", "Ports", "CPU", "Mem", ""]}>
                {data.containers.map((c) => {
                  const running = c.state === "running";
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[220px]">
                        <div className="truncate font-medium" title={c.id}>
                          {c.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted" title={c.image}>
                          {c.image}
                        </div>
                      </td>
                      <td className="max-w-[200px]">
                        <Pill tone={stateTone(c.state, c.status)}>{c.state}</Pill>
                        <div className="mt-0.5 truncate text-[11px] text-muted" title={c.status}>
                          {c.status}
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate font-mono text-[11px] text-muted" title={c.ports}>
                        {c.ports || "—"}
                      </td>
                      <td className="tabular-nums">{c.cpu ?? "—"}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted" title={c.mem ?? undefined}>
                        {c.mem?.split(" / ")[0] ?? "—"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-0.5">
                          {running ? (
                            <>
                              <button className="icon-btn" disabled={!!busy} onClick={() => void act(c.name, "restart")} aria-label={`Restart ${c.name}`} title="Restart">
                                {busy === `${c.name}:restart` ? <Spinner /> : <RotateCw size={13} />}
                              </button>
                              <button className="icon-btn hover:!text-err" disabled={!!busy} onClick={() => void act(c.name, "stop")} aria-label={`Stop ${c.name}`} title="Stop">
                                {busy === `${c.name}:stop` ? <Spinner /> : <Square size={12} />}
                              </button>
                            </>
                          ) : (
                            <button className="icon-btn hover:!text-ok" disabled={!!busy} onClick={() => void act(c.name, "start")} aria-label={`Start ${c.name}`} title="Start">
                              {busy === `${c.name}:start` ? <Spinner /> : <Play size={13} />}
                            </button>
                          )}
                          <button className="icon-btn" onClick={() => setLogsFor(c.name)} aria-label={`Logs for ${c.name}`} title="Logs (last 300 lines)">
                            <ScrollText size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <EmptyState compact icon={Boxes} title="No containers" hint="Nothing has been created on this target yet." />
            )}
          </Card>

          <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
            <Card title={`Images · ${data.images.length}`} icon={<Layers size={14} />}>
              {data.images.length ? (
                <ul className="max-h-72 space-y-0.5 overflow-y-auto text-[12px]">
                  {data.images.map((im, i) => (
                    <li key={i} className="flex gap-2 rounded px-1 py-0.5 hover:bg-elev/50">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={`${im.repo}:${im.tag}`}>
                        {im.repo}
                        <span className="text-muted">:{im.tag}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">{im.size}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">No images.</p>
              )}
            </Card>
            <Card title="Compose projects" icon={<Boxes size={14} />}>
              {data.compose.length ? (
                <ul className="space-y-1 text-[12px]">
                  {data.compose.map((p) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <Pill tone={/running/i.test(p.status) ? (/exited/i.test(p.status) ? "warn" : "ok") : "muted"}>{p.status}</Pill>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">No compose projects.</p>
              )}
            </Card>
          </div>
        </>
      )}

      {logsFor && <LogsDrawer title={`Logs · ${logsFor} · last 300 lines`} load={loadLogs} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

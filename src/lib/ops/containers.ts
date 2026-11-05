import "server-only";
import type { DockerInfo, K8sInfo } from "../opsTypes";
import { errorOf, findBin, NAME_RE, run, type ExecResult } from "./exec";
import { getServer, sshExec } from "./servers";

// ---------------------------------------------------------------------------
// Docker (or Podman) — on this Mac, or on a server over SSH
// ---------------------------------------------------------------------------

type DockerExec = (args: string[], timeout?: number) => Promise<ExecResult>;

function dockerFor(serverId?: string | null): { exec: DockerExec; target: string } | { error: string; target: string } {
  if (serverId) {
    const s = getServer(serverId);
    if (!s) return { error: "Server not found", target: "server" };
    // Fixed, validated argv joined for the remote shell.
    const quote = (a: string) => (/^[A-Za-z0-9_.:={}\\/-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
    return { target: s.name, exec: (args, timeout) => sshExec(s, ["docker", ...args].map(quote).join(" "), timeout) };
  }
  const bin = findBin(["docker", "podman"]);
  if (!bin) return { error: "Docker isn't installed on this Mac (Docker Desktop, OrbStack, Colima or Podman)", target: "This Mac" };
  return { target: "This Mac", exec: (args, timeout) => run(bin, args, { timeout }) };
}

const jsonLines = <T,>(out: string): T[] =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") || l.startsWith("["))
    .flatMap((l) => {
      try {
        const v = JSON.parse(l);
        return Array.isArray(v) ? v : [v];
      } catch {
        return [];
      }
    });

const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

export async function dockerInfo(serverId?: string | null): Promise<DockerInfo> {
  const d = dockerFor(serverId);
  const empty: DockerInfo = { available: false, target: d.target, containers: [], images: [], compose: [] };
  if ("error" in d) return { ...empty, error: d.error };
  const ps = await d.exec(["ps", "-a", "--format", "{{json .}}"]);
  if (!ps.ok) return { ...empty, error: errorOf(ps, "docker ps failed") };
  const [stats, images, compose] = await Promise.all([
    d.exec(["stats", "--no-stream", "--format", "{{json .}}"], 25_000),
    d.exec(["images", "--format", "{{json .}}"]),
    d.exec(["compose", "ls", "--format", "json"]),
  ]);
  const statByName = new Map(jsonLines<Record<string, unknown>>(stats.stdout).map((s) => [str(s.Name ?? s.name).replace(/^\//, ""), s]));
  return {
    available: true,
    target: d.target,
    containers: jsonLines<Record<string, unknown>>(ps.stdout).map((c) => {
      const name = str(c.Names ?? c.Name).replace(/^\//, "");
      const st = statByName.get(name);
      return {
        id: str(c.ID ?? c.Id).slice(0, 12),
        name,
        image: str(c.Image),
        state: str(c.State).toLowerCase(),
        status: str(c.Status),
        ports: typeof c.Ports === "string" ? c.Ports : str((c.Ports as { host_port?: number; container_port?: number }[] | undefined)?.map((p) => `${p.host_port}->${p.container_port}`)),
        cpu: st ? str(st.CPUPerc ?? st.cpu_percent) || null : null,
        mem: st ? str(st.MemUsage ?? st.mem_usage) || null : null,
      };
    }),
    images: jsonLines<Record<string, unknown>>(images.stdout).map((i) => ({ repo: str(i.Repository ?? (i.Names as string[] | undefined)?.[0] ?? i.Id), tag: str(i.Tag ?? ""), size: str(i.Size) })),
    compose: compose.ok ? jsonLines<Record<string, unknown>>(compose.stdout).map((p) => ({ name: str(p.Name), status: str(p.Status) })) : [],
  };
}

export async function dockerAction(serverId: string | null | undefined, container: string, action: "start" | "stop" | "restart" | "logs") {
  if (!NAME_RE.test(container)) throw new Error("Invalid container name");
  const d = dockerFor(serverId);
  if ("error" in d) throw new Error(d.error);
  const r = action === "logs" ? await d.exec(["logs", "--tail", "300", container], 30_000) : await d.exec([action, container], 60_000);
  if (!r.ok) throw new Error(errorOf(r, `docker ${action} failed`));
  // `docker logs` writes the container's stderr to stderr.
  return action === "logs" ? [r.stdout, r.stderr].filter(Boolean).join("\n") : r.stdout.trim() || `${action} ok`;
}

// ---------------------------------------------------------------------------
// Kubernetes (kubectl with your kubeconfig)
// ---------------------------------------------------------------------------

function age(ts?: string): string {
  const t = ts ? Date.parse(ts) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

interface KList<T> {
  items?: T[];
}

export async function k8sInfo(context?: string | null, namespace?: string | null): Promise<K8sInfo> {
  const bin = findBin(["kubectl"]);
  const empty: K8sInfo = { available: false, contexts: [], current: null, namespace: namespace || "default", namespaces: [], pods: [], deployments: [], services: [], events: [] };
  if (!bin) return { ...empty, error: "kubectl isn't installed (brew install kubectl)" };
  const [ctxs, cur] = await Promise.all([run(bin, ["config", "get-contexts", "-o", "name"]), run(bin, ["config", "current-context"])]);
  const contexts = ctxs.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const current = context && contexts.includes(context) ? context : cur.ok ? cur.stdout.trim() || null : null;
  if (!contexts.length || !current) return { ...empty, contexts, error: "No Kubernetes context in your kubeconfig" };
  const ns = namespace && NAME_RE.test(namespace) ? namespace : "default";
  const k = (args: string[]) => run(bin, ["--context", current, "--request-timeout=10s", ...args], { timeout: 20_000 });
  const nsr = await k(["get", "namespaces", "-o", "json"]);
  if (!nsr.ok) return { ...empty, contexts, current, namespace: ns, error: errorOf(nsr, "Cluster unreachable") };
  const [pods, deps, svcs, events] = await Promise.all([
    k(["-n", ns, "get", "pods", "-o", "json"]),
    k(["-n", ns, "get", "deployments", "-o", "json"]),
    k(["-n", ns, "get", "services", "-o", "json"]),
    k(["-n", ns, "get", "events", "--field-selector", "type=Warning", "-o", "json"]),
  ]);
  const parse = <T,>(r: ExecResult): T[] => {
    try {
      return (JSON.parse(r.stdout) as KList<T>).items ?? [];
    } catch {
      return [];
    }
  };
  type Meta = { metadata: { name: string; namespace?: string; creationTimestamp?: string } };
  return {
    available: true,
    contexts,
    current,
    namespace: ns,
    namespaces: parse<Meta>(nsr).map((n) => n.metadata.name),
    pods: parse<Meta & { spec?: { nodeName?: string }; status?: { phase?: string; containerStatuses?: { ready?: boolean; restartCount?: number }[] } }>(pods).map((p) => {
      const cs = p.status?.containerStatuses ?? [];
      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace ?? ns,
        phase: p.status?.phase ?? "Unknown",
        ready: `${cs.filter((c) => c.ready).length}/${cs.length}`,
        restarts: cs.reduce((a, c) => a + (c.restartCount ?? 0), 0),
        age: age(p.metadata.creationTimestamp),
        node: p.spec?.nodeName ?? "",
      };
    }),
    deployments: parse<Meta & { spec?: { replicas?: number }; status?: { readyReplicas?: number; availableReplicas?: number } }>(deps).map((d) => ({
      name: d.metadata.name,
      namespace: d.metadata.namespace ?? ns,
      desired: d.spec?.replicas ?? 0,
      ready: d.status?.readyReplicas ?? 0,
      available: d.status?.availableReplicas ?? 0,
    })),
    services: parse<Meta & { spec?: { type?: string; clusterIP?: string; ports?: { port: number; protocol?: string; nodePort?: number }[] } }>(svcs).map((s) => ({
      name: s.metadata.name,
      namespace: s.metadata.namespace ?? ns,
      type: s.spec?.type ?? "",
      clusterIp: s.spec?.clusterIP ?? "",
      ports: (s.spec?.ports ?? []).map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`).join(", "),
    })),
    events: parse<Meta & { type?: string; reason?: string; message?: string; involvedObject?: { kind?: string; name?: string }; lastTimestamp?: string }>(events)
      .slice(-30)
      .reverse()
      .map((e) => ({ type: e.type ?? "", reason: e.reason ?? "", object: `${e.involvedObject?.kind ?? ""}/${e.involvedObject?.name ?? ""}`, message: (e.message ?? "").slice(0, 300), age: age(e.lastTimestamp ?? e.metadata.creationTimestamp) })),
  };
}

export async function k8sAction(input: { context: string; namespace: string; kind: "pod" | "deployment"; name: string; action: "logs" | "restart" | "scale"; replicas?: number }) {
  const bin = findBin(["kubectl"]);
  if (!bin) throw new Error("kubectl isn't installed");
  if (![input.context, input.namespace, input.name].every((v) => NAME_RE.test(v) || /^[A-Za-z0-9_.:@/-]+$/.test(v))) throw new Error("Invalid name");
  const base = ["--context", input.context, "-n", input.namespace, "--request-timeout=20s"];
  let args: string[];
  if (input.action === "logs") args = input.kind === "pod" ? ["logs", input.name, "--all-containers", "--tail=300"] : ["logs", `deployment/${input.name}`, "--all-containers", "--tail=300"];
  else if (input.kind !== "deployment") throw new Error(`${input.action} works on deployments`);
  else if (input.action === "restart") args = ["rollout", "restart", `deployment/${input.name}`];
  else {
    const n = Math.floor(input.replicas ?? -1);
    if (!(n >= 0 && n <= 100)) throw new Error("Replicas must be 0–100");
    args = ["scale", `deployment/${input.name}`, `--replicas=${n}`];
  }
  const r = await run(bin, [...base, ...args], { timeout: 45_000 });
  if (!r.ok) throw new Error(errorOf(r, "kubectl failed"));
  return r.stdout.trim() || "ok";
}

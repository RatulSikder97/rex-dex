import "server-only";
import { getProject } from "../repo";
import type { OpsOverview, OpsProblem } from "../opsTypes";
import { dockerInfo, k8sInfo } from "./containers";
import { gitInfo } from "./gitinfo";
import { listMonitors } from "./monitors";
import { listServers } from "./servers";

/** Everything at a glance for a project, plus the problems worth acting on. */
export async function opsOverview(projectId: string | null): Promise<OpsOverview> {
  const project = projectId ? getProject(projectId) : undefined;
  const [git, docker, k8s] = await Promise.all([
    project?.repo_path ? gitInfo(project.repo_path).catch(() => null) : Promise.resolve(null),
    dockerInfo(null).catch((e) => ({ available: false, error: String(e), containers: [] as { state: string }[] })),
    k8sInfo(null, null).catch((e) => ({ available: false, error: String(e), current: null, pods: [] as { phase: string; restarts: number; name: string }[] })),
  ]);
  const servers = listServers(projectId);
  const monitors = listMonitors(projectId);
  const problems: OpsProblem[] = [];

  for (const m of monitors) {
    if (m.last && !m.last.ok) problems.push({ severity: "error", title: `${m.name} is down`, detail: `${m.url}: ${m.last.error ?? `HTTP ${m.last.status}`}`, section: "uptime" });
    if (m.last?.tlsDaysLeft != null && m.last.tlsDaysLeft < 14)
      problems.push({ severity: m.last.tlsDaysLeft < 3 ? "error" : "warn", title: `TLS certificate for ${new URL(m.url).hostname} expires in ${m.last.tlsDaysLeft} days`, detail: "Renew it (certbot renew / your host's dashboard).", section: "uptime" });
  }
  for (const s of servers) {
    const l = s.last;
    if (!l) continue;
    if (!l.ok) {
      problems.push({ severity: "error", title: `Can't reach ${s.name} over SSH`, detail: l.error ?? "SSH failed", section: "servers" });
      continue;
    }
    for (const d of l.system?.disks ?? []) if (d.pct >= 90) problems.push({ severity: d.pct >= 95 ? "error" : "warn", title: `${s.name}: disk ${d.mount} is ${d.pct}% full`, detail: `${d.usedGb} of ${d.sizeGb} GB used`, section: "servers" });
    if (l.system && l.system.load[1] > l.system.cpus * 1.5) problems.push({ severity: "warn", title: `${s.name}: high load`, detail: `5-min load ${l.system.load[1]} on ${l.system.cpus} CPUs`, section: "servers" });
    if (l.system && l.system.mem.totalMb && l.system.mem.availableMb / l.system.mem.totalMb < 0.08) problems.push({ severity: "warn", title: `${s.name}: low memory`, detail: `${l.system.mem.availableMb} MB available of ${l.system.mem.totalMb} MB`, section: "servers" });
    if (l.failedServices?.length) problems.push({ severity: "error", title: `${s.name}: ${l.failedServices.length} failed service${l.failedServices.length > 1 ? "s" : ""}`, detail: l.failedServices.join(", "), section: "servers" });
    const t = l.traffic;
    if (t) {
      const total = t.status["2xx"] + t.status["3xx"] + t.status["4xx"] + t.status["5xx"];
      if (total > 50 && t.status["5xx"] / total > 0.02) problems.push({ severity: "error", title: `${s.name}: ${Math.round((t.status["5xx"] / total) * 100)}% server errors (5xx)`, detail: `${t.status["5xx"]} of ${total} requests in ${t.source}`, section: "traffic" });
    }
  }
  if (git) {
    if (git.behind > 0) problems.push({ severity: "warn", title: `Branch ${git.branch} is ${git.behind} commit${git.behind > 1 ? "s" : ""} behind its remote`, detail: "Pull before deploying.", section: "git" });
    const failed = git.gh.runs.find((r) => r.conclusion === "failure");
    if (failed && git.gh.runs[0] === failed) problems.push({ severity: "error", title: `CI failing: ${failed.name}`, detail: `Latest run on ${failed.branch} failed`, section: "git" });
  }
  const pods = k8s.available ? (k8s as { pods: { phase: string; restarts: number; name: string }[] }).pods : [];
  for (const p of pods) {
    if (p.phase !== "Running" && p.phase !== "Succeeded") problems.push({ severity: "error", title: `Pod ${p.name} is ${p.phase}`, detail: "Check its events and logs.", section: "k8s" });
    else if (p.restarts > 5) problems.push({ severity: "warn", title: `Pod ${p.name} restarted ${p.restarts} times`, detail: "Likely crash-looping or OOM.", section: "k8s" });
  }

  const containers = (docker as { containers: { state: string }[] }).containers ?? [];
  return {
    git,
    servers,
    monitors,
    docker: { available: docker.available, running: containers.filter((c) => c.state === "running").length, total: containers.length, error: (docker as { error?: string }).error },
    k8s: {
      available: k8s.available,
      context: (k8s as { current: string | null }).current ?? null,
      podsRunning: pods.filter((p) => p.phase === "Running").length,
      podsTotal: pods.length,
      podsFailing: pods.filter((p) => p.phase !== "Running" && p.phase !== "Succeeded").length,
      error: (k8s as { error?: string }).error,
    },
    problems: problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)),
  };
}

// Shared, client-safe types for the Ops Center (servers, traffic, docker, k8s, uptime, git).
// Imported by both the API routes and the UI — keep this file free of runtime imports.

export interface Server {
  id: string;
  project_id: string | null;
  name: string;
  host: string;
  user: string | null;
  port: number;
  identity_file: string | null;
  log_path: string | null;
  created_at: number;
}

export interface Snapshot {
  at: number;
  ok: boolean;
  error?: string;
  ms: number;
  system?: {
    hostname: string;
    os: string;
    kernel: string;
    uptimeSec: number;
    load: [number, number, number];
    cpus: number;
    mem: { totalMb: number; usedMb: number; availableMb: number };
    swap: { totalMb: number; usedMb: number };
    disks: { fs: string; mount: string; sizeGb: number; usedGb: number; pct: number }[];
  };
  users?: { user: string; tty: string; from: string; since: string }[];
  lastLogins?: { user: string; from: string; when: string }[];
  connections?: {
    established: number;
    byIp: { ip: string; count: number }[];
    listening: { addr: string; port: number; process: string }[];
  };
  processes?: { pid: number; user: string; cpu: number; mem: number; cmd: string }[];
  failedServices?: string[];
  docker?: { available: boolean; containers: { name: string; image: string; status: string; ports: string }[] };
  traffic?: {
    source: string;
    lines: number;
    perMinute: { t: number; count: number }[];
    status: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
    topIps: { ip: string; count: number }[];
    topPaths: { path: string; count: number }[];
    topAgents: { agent: string; count: number }[];
    bots: { ai: number; search: number; other: number; human: number };
    aiCrawlers: { name: string; count: number }[];
  } | null;
}

export type ServerWithLast = Server & { last: Snapshot | null };

export interface SshHost {
  alias: string;
  hostname: string | null;
  user: string | null;
  port: number | null;
}

export interface DockerInfo {
  available: boolean;
  error?: string;
  target: string;
  containers: {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
    ports: string;
    cpu: string | null;
    mem: string | null;
  }[];
  images: { repo: string; tag: string; size: string }[];
  compose: { name: string; status: string }[];
}

export interface K8sInfo {
  available: boolean;
  error?: string;
  contexts: string[];
  current: string | null;
  namespace: string;
  namespaces: string[];
  pods: { name: string; namespace: string; phase: string; ready: string; restarts: number; age: string; node: string }[];
  deployments: { name: string; namespace: string; ready: number; desired: number; available: number }[];
  services: { name: string; namespace: string; type: string; clusterIp: string; ports: string }[];
  events: { type: string; reason: string; object: string; message: string; age: string }[];
}

export interface Monitor {
  id: string;
  project_id: string | null;
  name: string;
  url: string;
  created_at: number;
  last: {
    at: number;
    ok: boolean;
    status: number | null;
    ms: number | null;
    error: string | null;
    tlsDaysLeft: number | null;
  } | null;
  uptime24h: number | null;
  history: { at: number; ok: boolean; ms: number | null }[];
}

export interface GitInfo {
  branch: string | null;
  ahead: number;
  behind: number;
  remotes: { name: string; url: string; webUrl: string | null }[];
  commits: { hash: string; subject: string; author: string; at: number }[];
  gh: {
    available: boolean;
    error?: string;
    prs: { number: number; title: string; url: string; author: string; draft: boolean }[];
    runs: { name: string; branch: string; status: string; conclusion: string | null; url: string; at: number }[];
    issues: { number: number; title: string; url: string; author: string }[];
  };
}

export interface OpsProblem {
  severity: "error" | "warn";
  title: string;
  detail: string;
  section: string;
}

export interface OpsOverview {
  git: GitInfo | null;
  servers: ServerWithLast[];
  monitors: Monitor[];
  docker: { available: boolean; running: number; total: number; error?: string };
  k8s: {
    available: boolean;
    context: string | null;
    podsRunning: number;
    podsTotal: number;
    podsFailing: number;
    error?: string;
  };
  problems: OpsProblem[];
}

export type OpsSection = "overview" | "servers" | "traffic" | "docker" | "k8s" | "uptime" | "git";

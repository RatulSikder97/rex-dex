"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { MediaJob } from "@/lib/media/plan";
import type { InstalledPlugin } from "@/lib/plugins/types";
import type { Deliverable, Run, Task } from "@/lib/types";
import { useActiveProject, useWorkbench } from "@/store/workbench";

export interface MissionThread {
  thread_id: string;
  department: string;
  title: string;
  turns: number;
  updated_at: number;
  running: number;
}

export interface MediaFile {
  name: string;
  size: number;
  modified: number;
  kind: "video" | "audio" | "image";
}

export interface GitChange {
  path: string;
  from?: string;
  status: "M" | "A" | "D" | "R" | "C" | "U" | "T" | "?";
}

export interface GitStatusLite {
  repo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: GitChange[];
  unstaged: GitChange[];
  conflicts: GitChange[];
}

export interface MissionData {
  threads: MissionThread[];
  runs: Run[];
  jobs: MediaJob[];
  tasks: Task[];
  deliverables: Deliverable[];
  media: MediaFile[];
  git: GitStatusLite | null;
  plugins: InstalledPlugin[];
  /** First load of each source finished. */
  loaded: boolean;
  /** Last poll couldn't reach the engine (cleared by the next successful poll). */
  error: string | null;
  refresh: () => void;
}

const EMPTY: MissionData = { threads: [], runs: [], jobs: [], tasks: [], deliverables: [], media: [], git: null, plugins: [], loaded: false, error: null, refresh: () => {} };

const Ctx = createContext<MissionData>(EMPTY);
export const useMissionData = () => useContext(Ctx);

const FAST_MS = 3000;
const SLOW_MS = 12000;

/** Keeps the previous value when the payload is unchanged, so polling doesn't re-render everything. */
function useStable<T>(initial: T): [T, (next: T) => void] {
  const [v, setV] = useState<T>(initial);
  const last = useRef<string>(JSON.stringify(initial));
  const set = useCallback((next: T) => {
    const s = JSON.stringify(next);
    if (s === last.current) return;
    last.current = s;
    setV(next);
  }, []);
  return [v, set];
}

/**
 * One poller for everything Mission mode shows (task list, pipeline, output, issues), shared by the
 * left rail and the Workspace panel. Fast sources (conversations, runs, media jobs) every 3s; the rest every 12s
 * and whenever the store's `version` bumps.
 */
export function MissionDataProvider({ children }: { children: ReactNode }) {
  const project = useActiveProject();
  const pid = project?.id ?? null;
  const hasRepo = !!project?.repo_path;
  const version = useWorkbench((s) => s.version);
  const [threads, setThreads] = useStable<MissionThread[]>([]);
  const [runs, setRuns] = useStable<Run[]>([]);
  const [jobs, setJobs] = useStable<MediaJob[]>([]);
  const [tasks, setTasks] = useStable<Task[]>([]);
  const [deliverables, setDeliverables] = useStable<Deliverable[]>([]);
  const [media, setMedia] = useStable<MediaFile[]>([]);
  const [git, setGit] = useStable<GitStatusLite | null>(null);
  const [plugins, setPlugins] = useStable<InstalledPlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Reset when the project changes so stale data from another project never shows.
  useEffect(() => {
    setThreads([]);
    setRuns([]);
    setTasks([]);
    setDeliverables([]);
    setGit(null);
    setLoaded(false);
  }, [pid, setThreads, setRuns, setTasks, setDeliverables, setGit]);

  useEffect(() => {
    let stop = false;
    const q = pid ? `projectId=${encodeURIComponent(pid)}` : "";
    const fast = async () => {
      const [t, r, j] = await Promise.all([
        api<MissionThread[]>(`/api/threads/all?${q}`).catch(() => null),
        pid ? api<Run[]>(`/api/runs?${q}&limit=60`).catch(() => null) : Promise.resolve([] as Run[]),
        api<MediaJob[]>("/api/create/jobs").catch(() => null),
      ]);
      if (stop) return;
      setError(t ? null : "Couldn’t load tasks and runs. The REX engine may be restarting.");
      if (t) setThreads(t);
      // Swarm step runs are shown in the Swarms block, not as loose runs.
      if (r) setRuns(r.filter((x) => !x.thread_id?.startsWith("swarm:")));
      if (j) setJobs(j);
    };
    const slow = async () => {
      const [t, d, m, g, p] = await Promise.all([
        pid ? api<Task[]>(`/api/tasks?${q}`).catch(() => null) : Promise.resolve([] as Task[]),
        pid ? api<Deliverable[]>(`/api/deliverables?${q}`).catch(() => null) : Promise.resolve([] as Deliverable[]),
        api<MediaFile[]>("/api/media").catch(() => null),
        pid && hasRepo ? api<GitStatusLite>(`/api/git?${q}`).catch(() => null) : Promise.resolve(null),
        api<InstalledPlugin[]>("/api/plugins").catch(() => null),
      ]);
      if (stop) return;
      if (t) setTasks(t);
      if (d) setDeliverables(d);
      if (m) setMedia(m);
      setGit(g);
      if (p) setPlugins(p);
    };
    void Promise.all([fast(), slow()]).then(() => !stop && setLoaded(true));
    const a = setInterval(() => void fast(), FAST_MS);
    const b = setInterval(() => void slow(), SLOW_MS);
    return () => {
      stop = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, [pid, hasRepo, version, tick, setThreads, setRuns, setJobs, setTasks, setDeliverables, setMedia, setGit, setPlugins]);

  const value = useMemo<MissionData>(
    () => ({ threads, runs, jobs, tasks, deliverables, media, git, plugins, loaded, error, refresh }),
    [threads, runs, jobs, tasks, deliverables, media, git, plugins, loaded, error, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** First line of a brief, trimmed for list titles. */
export function briefTitle(brief: string, max = 80): string {
  const line = brief.split("\n").find((l) => l.trim())?.trim() ?? "Untitled";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function elapsed(from: number, to: number = Date.now()): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Re-renders every `ms` (live elapsed timers). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

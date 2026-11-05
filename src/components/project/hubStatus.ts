"use client";
import type { GitInfo, Monitor, ServerWithLast } from "@/lib/opsTypes";
import type { Project } from "@/lib/types";
import { useOpsFetch, type Tone } from "@/components/ops/shared";
import { serversUrl } from "@/components/ops/ServersSection";
import { serverHealth } from "@/components/ops/OverviewSection";
import { useConnections } from "@/components/views/ConnectionsView";

export type HubSection = "general" | "git" | "servers" | "uptime" | "deploy" | "connections" | "agents";

const ALIASES: Record<string, HubSection> = {
  general: "general",
  settings: "general",
  git: "git",
  repo: "git",
  repository: "git",
  servers: "servers",
  traffic: "servers",
  uptime: "uptime",
  domains: "uptime",
  monitors: "uptime",
  deploy: "deploy",
  docker: "deploy",
  k8s: "deploy",
  connections: "connections",
  agents: "agents",
};
export const asHubSection = (s?: string | null): HubSection => (s && ALIASES[s]) || "general";

export interface NavStatus {
  tone: Tone;
  label: string;
  /** Short badge text next to the dot (counts). */
  badge?: string;
}

const git = (p: Project, loaded: boolean, g: GitInfo | null, error: string | null): NavStatus | null => {
  if (!p.repo_path) return { tone: "warn", label: "No repository folder linked" };
  if (!loaded) return null;
  if (error && !g) return { tone: "err", label: "Couldn't read the repository" };
  if (!g) return { tone: "warn", label: "Folder isn't a git repository" };
  if (!g.remotes.length) return { tone: "warn", label: "No remote connected" };
  if (g.behind > 0) return { tone: "accent", label: `Remote connected · ${g.behind} behind` };
  return { tone: "ok", label: "Remote connected" };
};

const servers = (list: ServerWithLast[] | null): NavStatus | null => {
  if (!list) return null;
  if (!list.length) return { tone: "muted", label: "No servers" };
  const tones = list.map((s) => serverHealth(s).tone);
  const tone: Tone = tones.includes("err") ? "err" : tones.includes("warn") ? "warn" : tones.every((t) => t === "muted") ? "muted" : "ok";
  const label = tone === "err" ? "A server has problems" : tone === "warn" ? "A server is under pressure" : tone === "muted" ? "No snapshots yet" : "All servers healthy";
  return { tone, label: `${list.length} server${list.length === 1 ? "" : "s"} · ${label}`, badge: String(list.length) };
};

const uptime = (list: Monitor[] | null): NavStatus | null => {
  if (!list) return null;
  if (!list.length) return { tone: "muted", label: "No monitors" };
  const down = list.filter((m) => m.last && !m.last.ok).length;
  const up = list.filter((m) => m.last?.ok).length;
  if (down) return { tone: "err", label: `${down} of ${list.length} down`, badge: `${down}↓` };
  return { tone: up ? "ok" : "muted", label: up ? `${up} of ${list.length} up` : "Checks pending", badge: `${up}/${list.length}` };
};

/**
 * Light, shared status for the Project hub nav: git (also feeds the Repository
 * section), servers, monitors and connections — one request each.
 */
export function useHubStatus(project: Project | null, reloadKey: number) {
  const id = project?.id ?? null;
  const q = id ? `?projectId=${encodeURIComponent(id)}` : "";
  const gitFetch = useOpsFetch<GitInfo | null>(id ? `/api/ops/git${q}` : null, reloadKey);
  const srv = useOpsFetch<ServerWithLast[]>(id ? serversUrl(id) : null, reloadKey);
  const mon = useOpsFetch<Monitor[]>(id ? `/api/ops/monitors${q}` : null, reloadKey);
  const { list: conns } = useConnections();
  const connected = conns?.filter((c) => c.status === "connected").length ?? 0;

  const status: Partial<Record<HubSection, NavStatus | null>> = project
    ? {
        general: !project.repo_path
          ? { tone: "warn", label: "Repository folder not set" }
          : !project.description.trim()
            ? { tone: "warn", label: "Add a description (agents read it)" }
            : { tone: "ok", label: "Configured" },
        git: git(project, gitFetch.loaded, gitFetch.data, gitFetch.error),
        servers: servers(srv.data),
        uptime: uptime(mon.data),
        connections: conns ? { tone: connected ? "ok" : "muted", label: `${connected} of ${conns.length} connected`, badge: String(connected) } : null,
      }
    : {};

  return { git: gitFetch, status, reloadServers: srv.reload, reloadMonitors: mon.reload };
}

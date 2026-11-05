"use client";
import { useEffect, useState } from "react";
import { Activity, Boxes, FolderCog, GitBranch, LayoutGrid, Network, RefreshCw, Server as ServerIcon, Ship, type LucideIcon } from "lucide-react";
import type { OpsSection } from "@/lib/opsTypes";
import { useActiveProject } from "@/store/workbench";
import { Tabs } from "@/components/ui/kit";
import OverviewSection from "@/components/ops/OverviewSection";
import ServersSection from "@/components/ops/ServersSection";
import TrafficSection from "@/components/ops/TrafficSection";
import DockerSection from "@/components/ops/DockerSection";
import K8sSection from "@/components/ops/K8sSection";
import UptimeSection from "@/components/ops/UptimeSection";
import GitSection from "@/components/ops/GitSection";
import type { OpsNav } from "@/components/ops/shared";
import { openProjectHub } from "@/components/workbench/actions";

const SECTIONS: { value: OpsSection; label: string; icon: LucideIcon }[] = [
  { value: "overview", label: "Overview", icon: LayoutGrid },
  { value: "servers", label: "Servers", icon: ServerIcon },
  { value: "traffic", label: "Traffic", icon: Network },
  { value: "docker", label: "Docker", icon: Boxes },
  { value: "k8s", label: "Kubernetes", icon: Ship },
  { value: "uptime", label: "Uptime", icon: Activity },
  { value: "git", label: "Git", icon: GitBranch },
];

/** Ops Center: servers, traffic, docker, kubernetes, uptime and git for the active project — all in one place. */
export default function OpsView({ section = "overview" }: { section?: OpsSection }) {
  const project = useActiveProject();
  const [active, setActive] = useState<OpsSection>(section);
  const [reloadKey, setReloadKey] = useState(0);
  const [serverId, setServerId] = useState<string | null>(null);

  // The palette / rail can re-open this tab on another section.
  useEffect(() => setActive(section), [section]);

  // Keep the active tab visible when the row scrolls (narrow columns).
  useEffect(() => {
    document.getElementById(`ops-tab-${active}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const nav: OpsNav = {
    projectId: project?.id ?? null,
    reloadKey,
    serverId,
    setServerId,
    go: (s, id) => {
      if (id) setServerId(id);
      setActive(s);
    },
  };

  return (
    <div className="page @container">
      <div className="page-inner">
        <header className="page-head">
          <div className="page-head-main">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="page-title shrink-0">Ops</h1>
              {project && (
                <span className="min-w-0 truncate text-[13px] text-muted" title={project.name}>
                  {project.name}
                </span>
              )}
            </div>
            <p className="page-desc">Servers, traffic, containers, clusters, uptime and the repository for this project.</p>
          </div>
          <div className="page-actions">
            {project && (
              <button className="btn btn-sm" onClick={() => openProjectHub(project.id)} title="Project settings, repository, servers and connections">
                <FolderCog size={12} aria-hidden /> Project hub
              </button>
            )}
            <button className="icon-btn icon-btn-lg" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        <Tabs value={active} onChange={setActive} tabs={SECTIONS} label="Ops sections" idPrefix="ops-tab" className="mb-4" />

        <div id="ops-panel" role="tabpanel" aria-labelledby={`ops-tab-${active}`} className="min-w-0">
          {active === "overview" && <OverviewSection nav={nav} />}
          {active === "servers" && <ServersSection nav={nav} />}
          {active === "traffic" && <TrafficSection nav={nav} />}
          {active === "docker" && <DockerSection nav={nav} />}
          {active === "k8s" && <K8sSection nav={nav} />}
          {active === "uptime" && <UptimeSection nav={nav} />}
          {active === "git" && <GitSection nav={nav} />}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Activity, Boxes, FolderCog, GitBranch, LayoutGrid, Network, RefreshCw, Server as ServerIcon, ServerCog, Ship, type LucideIcon } from "lucide-react";
import type { OpsSection } from "@/lib/opsTypes";
import { useActiveProject } from "@/store/workbench";
import OverviewSection from "@/components/ops/OverviewSection";
import ServersSection from "@/components/ops/ServersSection";
import TrafficSection from "@/components/ops/TrafficSection";
import DockerSection from "@/components/ops/DockerSection";
import K8sSection from "@/components/ops/K8sSection";
import UptimeSection from "@/components/ops/UptimeSection";
import GitSection from "@/components/ops/GitSection";
import type { OpsNav } from "@/components/ops/shared";
import { openProjectHub } from "@/components/workbench/actions";

const SECTIONS: { id: OpsSection; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "servers", label: "Servers", icon: ServerIcon },
  { id: "traffic", label: "Traffic", icon: Network },
  { id: "docker", label: "Docker", icon: Boxes },
  { id: "k8s", label: "Kubernetes", icon: Ship },
  { id: "uptime", label: "Uptime", icon: Activity },
  { id: "git", label: "Git & links", icon: GitBranch },
];

/** Ops Center: servers, traffic, docker, kubernetes, uptime and git for the active project — all in one place. */
export default function OpsView({ section = "overview" }: { section?: OpsSection }) {
  const project = useActiveProject();
  const [active, setActive] = useState<OpsSection>(section);
  const [reloadKey, setReloadKey] = useState(0);
  const [serverId, setServerId] = useState<string | null>(null);

  // The palette / rail can re-open this tab on another section.
  useEffect(() => setActive(section), [section]);

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

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length];
    setActive(next.id);
    requestAnimationFrame(() => document.getElementById(`ops-tab-${next.id}`)?.focus());
  };

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-16 @3xl:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <ServerCog size={18} className="text-accent" /> Ops
              {project && <span className="truncate text-[13px] font-normal text-muted">· {project.name}</span>}
            </h1>
            <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">Servers, traffic, containers, clusters, uptime and the repo — everything that keeps the product running, in one place.</p>
          </div>
          <div className="flex items-center gap-2">
            {project && (
              <button className="btn h-7" onClick={() => openProjectHub(project.id)} title="Project settings, repository, servers and connections">
                <FolderCog size={12} /> Project hub
              </button>
            )}
            <button className="btn h-7" onClick={() => setReloadKey((k) => k + 1)} title="Reload this section">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Ops sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s, i) => {
            const on = s.id === active;
            return (
              <button
                key={s.id}
                id={`ops-tab-${s.id}`}
                role="tab"
                aria-selected={on}
                aria-controls="ops-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(s.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] ${on ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                <s.icon size={13} /> {s.label}
              </button>
            );
          })}
        </div>

        <div id="ops-panel" role="tabpanel" aria-labelledby={`ops-tab-${active}`}>
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

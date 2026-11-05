"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Boxes, Cable, ExternalLink, FolderCog, Globe, KanbanSquare, Pencil, RefreshCw, Rocket, Server as ServerIcon, ServerCog, Settings2, GitBranch, type LucideIcon } from "lucide-react";
import type { OpsSection } from "@/lib/opsTypes";
import { useWorkbench, type ProjectHubIntent } from "@/store/workbench";
import { EmptyState } from "@/components/ui/empty";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { Card, CopyButton, Dot, Pill, type OpsNav, type Tone } from "@/components/ops/shared";
import ServersSection from "@/components/ops/ServersSection";
import UptimeSection from "@/components/ops/UptimeSection";
import DockerSection from "@/components/ops/DockerSection";
import K8sSection from "@/components/ops/K8sSection";
import ConnectionsView from "@/components/views/ConnectionsView";
import { DepartmentsCard } from "@/components/settings/AgentSettings";
import GeneralSection, { type GeneralField } from "@/components/project/GeneralSection";
import RepositorySection from "@/components/project/RepositorySection";
import { asHubSection, useHubStatus, type HubSection } from "@/components/project/hubStatus";

const SECTIONS: { id: HubSection; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: "general", label: "General", icon: Settings2, blurb: "Name, description, stage, website and the repository folder." },
  { id: "git", label: "Repository & Git", icon: GitBranch, blurb: "Connect a remote, create the GitHub repo, sync and follow PRs / CI." },
  { id: "servers", label: "Servers", icon: ServerIcon, blurb: "SSH hosts this project runs on: health, sessions, traffic, terminal." },
  { id: "uptime", label: "Domains & Uptime", icon: Activity, blurb: "The project website and the endpoints REX checks every minute." },
  { id: "deploy", label: "Deploy", icon: Rocket, blurb: "Containers and clusters: Docker on this Mac or a server, and Kubernetes." },
  { id: "connections", label: "Connections", icon: Cable, blurb: "Services and desktop apps your department agents can use." },
  { id: "agents", label: "Agents", icon: Bot, blurb: "Which agent each department runs on." },
];

const STAGE_TONE: Record<string, Tone> = { idea: "muted", planning: "muted", building: "accent", testing: "warn", launched: "ok", growing: "ok" };

/** Intents are one-shot: tabs persist across reloads, so stale or already-handled ones are ignored. */
const handledIntents = new Set<number>();
const INTENT_TTL = 10_000;

const OPS_TO_HUB: Partial<Record<OpsSection, HubSection>> = { servers: "servers", uptime: "uptime", docker: "deploy", k8s: "deploy", git: "git" };

/** Project hub: everything about one project — settings, repository, servers, uptime, deploy, connections and agents. */
export default function ProjectHub({ projectId, section, intent }: { projectId: string; section?: string; intent?: { kind: ProjectHubIntent; key: number } }) {
  const project = useWorkbench((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const projectsLoaded = useWorkbench((s) => s.projectsLoaded);
  const openTab = useWorkbench((s) => s.openTab);
  const [active, setActive] = useState<HubSection>(() => asHubSection(section));
  const [reloadKey, setReloadKey] = useState(0);
  const [serverId, setServerId] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<{ connect?: number; server?: number; monitor?: number }>({});
  const [generalFocus, setGeneralFocus] = useState<{ field: GeneralField; key: number } | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const { git, status } = useHubStatus(project, reloadKey);

  // The palette / menus re-open this tab with another section (the tab id doesn't include it).
  useEffect(() => {
    if (section) setActive(asHubSection(section));
  }, [section]);

  // Keep the active item visible in the horizontal (narrow) nav.
  useEffect(() => {
    document.getElementById(`hub-nav-${active}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!intent || handledIntents.has(intent.key)) return;
    handledIntents.add(intent.key);
    if (Date.now() - intent.key > INTENT_TTL) return;
    const k = intent.key;
    if (intent.kind === "connect-repo") {
      setActive("git");
      setTriggers((t) => ({ ...t, connect: k }));
    } else if (intent.kind === "add-server") {
      setActive("servers");
      setTriggers((t) => ({ ...t, server: k }));
    } else if (intent.kind === "add-monitor") {
      setActive("uptime");
      setTriggers((t) => ({ ...t, monitor: k }));
    }
  }, [intent]);

  const go = (s: HubSection) => {
    setActive(s);
    main.current?.scrollTo({ top: 0 });
  };
  const editGeneral = (field: GeneralField) => {
    go("general");
    setGeneralFocus({ field, key: Date.now() });
  };
  const openOps = (sec?: OpsSection) => {
    const s = useWorkbench.getState();
    if (project && s.projectId !== project.id) s.setProject(project.id);
    openTab(sec ? { kind: "ops", section: sec } : { kind: "ops" }, "Ops");
  };

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        {projectsLoaded ? <EmptyState icon={FolderCog} title="Project not found" hint="It may have been deleted. Pick another project from the title bar." /> : <p className="text-[12.5px] text-muted">Loading…</p>}
      </div>
    );
  }

  const nav: OpsNav = {
    projectId: project.id,
    reloadKey,
    serverId,
    setServerId,
    go: (s, id) => {
      if (id) setServerId(id);
      const h = OPS_TO_HUB[s];
      if (h) go(h);
      else openOps(s);
    },
  };

  const onNavKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? SECTIONS.length - 1 : d ? (i + d + SECTIONS.length) % SECTIONS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    document.getElementById(`hub-nav-${SECTIONS[to].id}`)?.focus();
  };

  const meta = SECTIONS.find((s) => s.id === active)!;
  const site = project.website_url.trim();
  const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null;

  return (
    <div ref={main} className="@container h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-16 @3xl:px-6">
        {/* ------------------------------------------------ header */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <ProjectAvatar project={project} size={44} onClick={() => openLogoStudio(project.id)} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-lg font-semibold">{project.name}</h1>
              <Pill tone={STAGE_TONE[project.stage] ?? "muted"} title="Stage">
                {project.stage}
              </Pill>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px]">
              {project.repo_path ? (
                <>
                  <span className="min-w-0 truncate font-mono text-[11.5px] text-muted" title={project.repo_path}>
                    {project.repo_path}
                  </span>
                  <CopyButton text={project.repo_path} label="Copy path" />
                </>
              ) : (
                <button className="flex items-center gap-1 text-warn hover:underline" onClick={() => editGeneral("repo")}>
                  No repository folder — link one
                </button>
              )}
              {siteHref && (
                <a href={siteHref} target="_blank" rel="noreferrer" className="hidden min-w-0 items-center gap-1 truncate text-accent hover:underline @2xl:flex" title={siteHref}>
                  <Globe size={11} className="shrink-0" /> <span className="truncate">{site.replace(/^https?:\/\//, "")}</span>
                </a>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button className="btn h-7" onClick={() => openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)}>
              <KanbanSquare size={12} /> Open board
            </button>
            <button className="btn h-7" onClick={() => openOps()}>
              <ServerCog size={12} /> Open Ops Center
            </button>
            <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh project status" title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>
        </header>

        {/* ------------------------------------------------ nav + section */}
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Project sections" className="min-w-0 @3xl:sticky @3xl:top-0 @3xl:self-start">
            <ul className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:none] @3xl:mx-0 @3xl:flex-col @3xl:gap-0.5 @3xl:overflow-visible @3xl:border-b-0 @3xl:px-0 [&::-webkit-scrollbar]:hidden">
              {SECTIONS.map((s, i) => {
                const on = s.id === active;
                const st = status[s.id];
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      id={`hub-nav-${s.id}`}
                      aria-current={on ? "page" : undefined}
                      onClick={() => go(s.id)}
                      onKeyDown={(e) => onNavKey(e, i)}
                      title={st?.label}
                      className={`flex w-full items-center gap-2 text-left text-[12.5px] ${
                        on
                          ? "-mb-px border-b-2 border-accent font-medium text-fg @3xl:mb-0 @3xl:border-b-0 @3xl:bg-hover"
                          : "-mb-px border-b-2 border-transparent text-muted hover:text-fg @3xl:mb-0 @3xl:border-b-0 @3xl:hover:bg-hover/60"
                      } px-2.5 pb-2 pt-1 @3xl:rounded-md @3xl:py-1.5`}
                    >
                      <s.icon size={13} className={on ? "text-accent" : ""} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {st?.badge && <span className="hidden text-[10.5px] tabular-nums text-faint @3xl:inline">{st.badge}</span>}
                      {st && <Dot tone={st.tone} label={st.label} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="@container min-w-0" aria-labelledby="hub-section-title">
            <div className="mb-3">
              <h2 id="hub-section-title" className="flex items-center gap-2 text-[15px] font-semibold">
                <meta.icon size={15} className="text-accent" aria-hidden /> {meta.label}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">{meta.blurb}</p>
            </div>

            {active === "general" && <GeneralSection project={project} focus={generalFocus} onSaved={() => setReloadKey((k) => k + 1)} />}
            {active === "git" && <RepositorySection project={project} git={git} connectKey={triggers.connect} onLinkFolder={() => editGeneral("repo")} />}
            {active === "servers" && <ServersSection nav={nav} addIntent={triggers.server} />}
            {active === "uptime" && (
              <div className="space-y-4">
                <Card title="Website" icon={<Globe size={14} />} action={<button className="btn h-7" onClick={() => editGeneral("website")}><Pencil size={12} /> Edit</button>}>
                  {siteHref ? (
                    <a href={siteHref} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-[12px] text-accent hover:underline">
                      <span className="truncate">{siteHref}</span> <ExternalLink size={11} className="shrink-0" />
                    </a>
                  ) : (
                    <p className="text-[12px] text-muted">No website set. Add it in General: SEO/AEO agents audit it and you can monitor it below.</p>
                  )}
                </Card>
                <div>
                  <h3 className="section-title mb-2">Uptime monitors</h3>
                  <UptimeSection nav={nav} project={project} addIntent={triggers.monitor} />
                </div>
              </div>
            )}
            {active === "deploy" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-elev/30 p-3">
                  <p className="min-w-0 flex-1 text-[12px] text-muted">Traffic, server logs and the full overview live in the Ops Center.</p>
                  <button className="btn h-7" onClick={() => openOps()}>
                    <ServerCog size={12} /> Open full Ops Center
                  </button>
                </div>
                <section aria-labelledby="hub-docker">
                  <h3 id="hub-docker" className="section-title mb-2 flex items-center gap-1.5">
                    <Boxes size={12} /> Docker
                  </h3>
                  <DockerSection nav={nav} />
                </section>
                <section aria-labelledby="hub-k8s">
                  <h3 id="hub-k8s" className="section-title mb-2 flex items-center gap-1.5">
                    <Rocket size={12} /> Kubernetes
                  </h3>
                  <K8sSection nav={nav} />
                </section>
              </div>
            )}
            {active === "connections" && <ConnectionsView embedded />}
            {active === "agents" && (
              <div className="space-y-2">
                <p className="text-[12px] text-faint">Agent choices are workspace-wide: they apply to every project.</p>
                <DepartmentsCard />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

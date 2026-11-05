"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Boxes, Cable, ExternalLink, FolderCog, Globe, KanbanSquare, Pencil, RefreshCw, Rocket, Server as ServerIcon, ServerCog, Settings2, GitBranch, type LucideIcon } from "lucide-react";
import type { OpsSection } from "@/lib/opsTypes";
import { useWorkbench, type ProjectHubIntent } from "@/store/workbench";
import { EmptyState } from "@/components/ui/empty";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { Card, CopyButton, Dot, Pill, type OpsNav, type Tone } from "@/components/ops/shared";
import { LoadingRows, Tabs } from "@/components/ui/kit";
import ServersSection from "@/components/ops/ServersSection";
import UptimeSection from "@/components/ops/UptimeSection";
import DockerSection from "@/components/ops/DockerSection";
import K8sSection from "@/components/ops/K8sSection";
import ConnectionsView from "@/components/views/ConnectionsView";
import { DepartmentsCard } from "@/components/settings/AgentSettings";
import GeneralSection, { type GeneralField } from "@/components/project/GeneralSection";
import RepositorySection from "@/components/project/RepositorySection";
import { asHubSection, useHubStatus, type HubSection } from "@/components/project/hubStatus";

const SECTIONS: { value: HubSection; label: string; title: string; icon: LucideIcon; blurb: string }[] = [
  { value: "general", label: "General", title: "General", icon: Settings2, blurb: "Name, description, stage, website and the repository folder." },
  { value: "git", label: "Repository", title: "Repository and git", icon: GitBranch, blurb: "Connect a remote, create the GitHub repository, sync, and follow pull requests and CI." },
  { value: "servers", label: "Servers", title: "Servers", icon: ServerIcon, blurb: "SSH hosts this project runs on: health, sessions, traffic and a terminal." },
  { value: "uptime", label: "Domains", title: "Domains and uptime", icon: Activity, blurb: "The project website and the endpoints REX checks every minute." },
  { value: "deploy", label: "Deploy", title: "Deploy", icon: Rocket, blurb: "Containers and clusters: Docker on this Mac or a server, and Kubernetes." },
  { value: "connections", label: "Connections", title: "Connections", icon: Cable, blurb: "Services and desktop apps your department agents can use." },
  { value: "agents", label: "Agents", title: "Agents", icon: Bot, blurb: "Which agent each department runs on." },
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

  // Keep the active tab visible in the horizontal (narrow) tab row.
  useEffect(() => {
    const el = document.getElementById(`hub-tab-${active}`);
    if (el?.offsetParent) el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
        {projectsLoaded ? <EmptyState icon={FolderCog} title="Project not found" hint="It may have been deleted. Pick another project from the title bar." /> : <LoadingRows rows={4} className="w-[320px]" />}
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
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? SECTIONS.length - 1 : d ? (i + d + SECTIONS.length) % SECTIONS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    go(SECTIONS[to].value);
    document.getElementById(`hub-nav-${SECTIONS[to].value}`)?.focus();
  };

  const meta = SECTIONS.find((s) => s.value === active)!;
  const site = project.website_url.trim();
  const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null;
  const stage = project.stage.charAt(0).toUpperCase() + project.stage.slice(1);

  return (
    <div ref={main} className="page @container">
      <div className="page-inner !max-w-[1200px]">
        {/* ------------------------------------------------ header */}
        <header className="page-head flex-wrap">
          <div className="flex min-w-0 flex-1 basis-[260px] items-start gap-3">
          <ProjectAvatar project={project} size={40} onClick={() => openLogoStudio(project.id)} />
          <div className="page-head-main">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="page-title min-w-0 truncate" title={project.name}>
                {project.name}
              </h1>
              <Pill tone={STAGE_TONE[project.stage] ?? "muted"} title="Stage">
                {stage}
              </Pill>
            </div>
            <div className="mt-0.5 flex h-6 min-w-0 items-center gap-1">
              {project.repo_path ? (
                <>
                  <span className="min-w-0 truncate font-mono text-[12px] text-muted" title={project.repo_path}>
                    {project.repo_path}
                  </span>
                  <CopyButton text={project.repo_path} label="Copy path" iconOnly />
                </>
              ) : (
                <button className="text-[12px] text-warn hover:underline" onClick={() => editGeneral("repo")}>
                  No repository folder. Link one
                </button>
              )}
              {siteHref && (
                <a href={siteHref} target="_blank" rel="noreferrer" className="ml-2 hidden min-w-0 shrink items-center gap-1 text-[12px] text-accent hover:underline @2xl:flex" title={siteHref}>
                  <Globe size={11} className="shrink-0" aria-hidden /> <span className="truncate">{site.replace(/^https?:\/\//, "")}</span>
                </a>
              )}
            </div>
          </div>
          </div>
          <div className="page-actions">
            <button className="btn btn-sm" onClick={() => openTab({ kind: "board", projectId: project.id }, `${project.name} · Board`)}>
              <KanbanSquare size={12} aria-hidden /> Open board
            </button>
            <button className="btn btn-sm" onClick={() => openOps()}>
              <ServerCog size={12} aria-hidden /> Open Ops
            </button>
            <button className="icon-btn" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh project status" title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>
        </header>

        {/* ------------------------------------------------ nav: tabs when narrow, a settings-style list when wide */}
        <Tabs
          value={active}
          onChange={go}
          label="Project sections"
          idPrefix="hub-tab"
          className="mb-4 @3xl:hidden"
          tabs={SECTIONS.map((s) => {
            const st = status[s.value];
            return { value: s.value, label: s.label, icon: s.icon, badge: st ? <Dot tone={st.tone} label={st.label} /> : undefined };
          })}
        />

        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[184px_minmax(0,1fr)]">
          <nav aria-label="Project sections" className="hidden min-w-0 @3xl:sticky @3xl:top-0 @3xl:block @3xl:self-start">
            <ul className="space-y-px">
              {SECTIONS.map((s, i) => {
                const on = s.value === active;
                const st = status[s.value];
                return (
                  <li key={s.value}>
                    <button
                      id={`hub-nav-${s.value}`}
                      aria-current={on ? "page" : undefined}
                      tabIndex={on ? 0 : -1}
                      onClick={() => go(s.value)}
                      onKeyDown={(e) => onNavKey(e, i)}
                      title={st?.label ?? s.label}
                      className={`row h-7 w-full rounded-[4px] px-2 text-left text-[12.5px] ${on ? "font-medium text-fg" : "text-muted hover:text-fg"}`}
                    >
                      <s.icon size={13} className={`shrink-0 ${on ? "text-accent" : ""}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {st?.badge && <span className="text-[11px] tabular-nums text-faint">{st.badge}</span>}
                      {st && <Dot tone={st.tone} label={st.label} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="@container min-w-0" aria-labelledby="hub-section-title">
            <div className="mb-4">
              <h2 id="hub-section-title" className="section-h">
                {meta.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">{meta.blurb}</p>
            </div>

            {active === "general" && <GeneralSection project={project} focus={generalFocus} onSaved={() => setReloadKey((k) => k + 1)} />}
            {active === "git" && <RepositorySection project={project} git={git} connectKey={triggers.connect} onLinkFolder={() => editGeneral("repo")} />}
            {active === "servers" && <ServersSection nav={nav} addIntent={triggers.server} />}
            {active === "uptime" && (
              <div className="space-y-6">
                <Card
                  title="Website"
                  icon={<Globe size={13} />}
                  action={
                    <button className="btn btn-sm" onClick={() => editGeneral("website")}>
                      <Pencil size={12} aria-hidden /> Edit
                    </button>
                  }
                >
                  {siteHref ? (
                    <a href={siteHref} target="_blank" rel="noreferrer" title={siteHref} className="inline-flex max-w-full items-center gap-1 font-mono text-[12px] text-accent hover:underline">
                      <span className="truncate">{siteHref}</span> <ExternalLink size={11} className="shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <p className="text-[12px] text-muted">No website set. Add it in General: the SEO &amp; AEO agents audit it and you can monitor it below.</p>
                  )}
                </Card>
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold">Uptime monitors</h3>
                  <UptimeSection nav={nav} project={project} addIntent={triggers.monitor} />
                </div>
              </div>
            )}
            {active === "deploy" && (
              <div className="space-y-6">
                <div className="card flex flex-wrap items-center gap-2 px-3 py-2">
                  <p className="min-w-0 flex-1 text-[12px] text-muted">Traffic, server logs and the full overview live in Ops.</p>
                  <button className="btn btn-sm" onClick={() => openOps()}>
                    <ServerCog size={12} aria-hidden /> Open Ops
                  </button>
                </div>
                <section aria-labelledby="hub-docker">
                  <h3 id="hub-docker" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                    <Boxes size={13} className="text-muted" aria-hidden /> Docker
                  </h3>
                  <DockerSection nav={nav} />
                </section>
                <section aria-labelledby="hub-k8s">
                  <h3 id="hub-k8s" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                    <Rocket size={13} className="text-muted" aria-hidden /> Kubernetes
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

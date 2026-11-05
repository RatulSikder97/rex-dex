"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleAlert, Code2, FolderGit2, FolderPlus, MonitorPlay, PackageOpen, PanelRightClose, Workflow, type LucideIcon } from "lucide-react";
import { newProjectFlow, openFolderFlow } from "@/components/workbench/actions";
import { useActiveProject, useWorkbench, type MissionTab } from "@/store/workbench";
import AgentLive from "./AgentLive";
import CodeTab from "./CodeTab";
import { useMissionData } from "./data";
import IssuesTab, { useIssues } from "./IssuesTab";
import OutputTab from "./OutputTab";
import PipelineTab from "./PipelineTab";
import { PanelEmpty, TabBadge } from "./ui";

const TABS: { id: MissionTab; label: string; icon: LucideIcon }[] = [
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "live", label: "Live", icon: MonitorPlay },
  { id: "output", label: "Output", icon: PackageOpen },
  { id: "issues", label: "Issues", icon: CircleAlert },
  { id: "code", label: "Code", icon: Code2 },
];

/** Badge counts for the Workspace tabs (also used by the collapsed Workspace button). */
export function useWorkspaceBadges() {
  const { runs, jobs, deliverables, media } = useMissionData();
  const issues = useIssues();
  const seen = useWorkbench((s) => s.missionOutputSeen);
  const running = runs.filter((r) => r.status === "running").length + jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const fresh = deliverables.filter((d) => d.updated_at > seen).length + media.filter((m) => m.modified > seen).length;
  return { running, issues: issues.length, issueErrors: issues.filter((i) => i.severity === "error").length, output: fresh };
}

/** Right-hand Mission panel: Pipeline (default), Live agent terminal, Output, Issues, optional Code. */
export default function Workspace({ onClose }: { onClose: () => void }) {
  const project = useActiveProject();
  const tab = useWorkbench((s) => s.missionTab);
  const setMission = useWorkbench((s) => s.setMission);
  const badges = useWorkspaceBadges();
  const { error: dataError, refresh } = useMissionData();
  // Keep visited tabs mounted (the Live terminal and Monaco are expensive to rebuild).
  const [visited, setVisited] = useState<Set<MissionTab>>(() => new Set([tab]));
  const [outputSeenAt, setOutputSeenAt] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))), [tab]);

  // First run: treat the last day as "new"; afterwards the Output badge counts what arrived since it was last opened.
  useEffect(() => {
    if (!useWorkbench.getState().missionOutputSeen) setMission({ missionOutputSeen: Date.now() - 86400_000 });
  }, [setMission]);
  useEffect(() => {
    if (tab !== "output") return;
    setOutputSeenAt(useWorkbench.getState().missionOutputSeen);
    setMission({ missionOutputSeen: Date.now() });
    return () => setMission({ missionOutputSeen: Date.now() });
  }, [tab, setMission]);

  const select = (t: MissionTab) => setMission({ missionTab: t });
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const badge = (id: MissionTab) =>
    id === "pipeline" ? <TabBadge n={badges.running} /> : id === "issues" ? <TabBadge n={badges.issues} tone={badges.issueErrors ? "err" : "accent"} /> : id === "output" && tab !== "output" ? <TabBadge n={badges.output} tone="ok" /> : null;

  return (
    <section aria-label="Workspace" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-line pl-1.5 pr-1.5">
        <div role="tablist" aria-label="Workspace" className="tabs min-w-0 flex-1 !border-b-0" onKeyDown={onKey}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`mission-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`mission-panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                className={`!h-full ${t.id === "code" ? "ml-auto" : ""}`}
                onClick={() => select(t.id)}
              >
                <t.icon size={13} strokeWidth={1.8} className={on ? "text-accent" : ""} aria-hidden />
                {t.label}
                {badge(t.id)}
              </button>
            );
          })}
        </div>
        <button className="icon-btn shrink-0 self-center" onClick={onClose} aria-label="Hide workspace" title="Hide workspace">
          <PanelRightClose size={15} />
        </button>
      </div>

      {project && dataError && (
        <div role="alert" className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-[color-mix(in_srgb,var(--err)_10%,var(--bg-editor))] px-3 text-[12px]">
          <CircleAlert size={13} className="shrink-0 text-err" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={dataError}>
            {dataError}
          </span>
          <button className="btn btn-sm btn-ghost shrink-0" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {!project ? (
          <PanelEmpty icon={FolderPlus} title="Start with a project" hint="Its plan, live work, output and issues collect here.">
            <button className="btn btn-primary" onClick={() => void newProjectFlow()}>
              <FolderPlus size={13} /> New project
            </button>
            <button className="btn" onClick={() => void openFolderFlow()}>
              Open folder…
            </button>
          </PanelEmpty>
        ) : (
          TABS.filter((t) => visited.has(t.id) || t.id === tab).map((t) => (
            <div
              key={t.id}
              role="tabpanel"
              id={`mission-panel-${t.id}`}
              aria-labelledby={`mission-tab-${t.id}`}
              hidden={tab !== t.id}
              className={`rx-fade absolute inset-0 ${tab !== t.id ? "hidden" : t.id === "live" || t.id === "code" ? "flex flex-col" : "overflow-y-auto"}`}
            >
              {t.id === "pipeline" && <PipelineTab />}
              {t.id === "live" && <AgentLive />}
              {t.id === "output" && <OutputTab seenAt={outputSeenAt} />}
              {t.id === "issues" && <IssuesTab />}
              {t.id === "code" && <CodeTab />}
            </div>
          ))
        )}
      </div>
      {project && !project.repo_path && tab === "pipeline" && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line bg-side px-3 text-[12px] text-muted">
          <FolderGit2 size={13} className="text-faint" />
          <span className="min-w-0 flex-1 truncate" title="Link a repo so Engineering and QA can work on code.">Link a repo so Engineering and QA can work on code.</span>
          <button className="btn btn-sm shrink-0" onClick={() => useWorkbench.getState().openTab({ kind: "project", projectId: project.id }, `${project.name} · Settings`)}>
            Link repo
          </button>
        </div>
      )}
    </section>
  );
}

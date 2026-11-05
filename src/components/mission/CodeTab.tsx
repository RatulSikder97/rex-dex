"use client";
import dynamic from "next/dynamic";
import { Code2, FileCode, FolderGit2 } from "lucide-react";
import Explorer from "@/components/sidebar/Explorer";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { openProjectSettings } from "@/components/workbench/actions";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { openInCodeMode } from "./nav";
import { PanelEmpty } from "./ui";

const FileEditor = dynamic(() => import("@/components/views/FileEditor"), { ssr: false, loading: () => <Skeleton className="m-4 h-40" /> });

/**
 * Optional source view: the project's file tree + the file picked in it. Explorer opens files as
 * editor tabs; this tab previews the active (or most recent) file tab, so Code mode picks up right there.
 */
export default function CodeTab() {
  const project = useActiveProject();
  const tabs = useWorkbench((s) => s.tabs);
  const activeTabId = useWorkbench((s) => s.activeTabId);

  if (!project) return null;
  if (!project.repo_path)
    return (
      <PanelEmpty icon={FolderGit2} title="No repository linked" hint="Link the project folder so Engineering and QA can work in it, and browse the code here.">
        <button type="button" className="btn btn-primary" onClick={() => openProjectSettings(project.id)}>
          <FolderGit2 size={13} /> Link repo
        </button>
      </PanelEmpty>
    );

  const files = tabs.filter((t) => t.spec.kind === "file" && t.spec.projectId === project.id);
  const file = files.find((t) => t.id === activeTabId) ?? files[files.length - 1] ?? null;
  const spec = file?.spec.kind === "file" ? file.spec : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="no-x-scroll w-[200px] shrink-0 overflow-y-auto border-r border-line bg-side py-1" aria-label="Files">
        <Explorer projectId={project.id} title={project.name} rootPath={project.repo_path} />
      </div>
      <div className="@container flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-2">
          <FileCode size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={spec?.path}>
            {spec ? spec.path : "Pick a file to preview"}
          </span>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => openInCodeMode()} title="Open in Code mode (⌘⇧M)" aria-label="Open in Code mode">
            <Code2 size={13} /> <span className="@max-xs:hidden">Open in Code mode</span>
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {file && spec ? (
            <FileEditor key={file.id} tabId={file.id} projectId={spec.projectId} path={spec.path} />
          ) : (
            <EmptyState icon={FileCode} title="Source code is optional here" hint="Agents do the coding. Browse the tree to peek at a file, or open Code mode for the full IDE." compact />
          )}
        </div>
      </div>
    </div>
  );
}

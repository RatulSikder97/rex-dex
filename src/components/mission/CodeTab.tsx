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
        <button className="rx-primary rx-press h-8 rounded-lg px-3 text-[12px]" onClick={() => openProjectSettings(project.id)}>
          <FolderGit2 size={13} /> Link repo
        </button>
      </PanelEmpty>
    );

  const files = tabs.filter((t) => t.spec.kind === "file" && t.spec.projectId === project.id);
  const file = files.find((t) => t.id === activeTabId) ?? files[files.length - 1] ?? null;
  const spec = file?.spec.kind === "file" ? file.spec : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-side py-1" aria-label="Files">
        <Explorer projectId={project.id} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <FileCode size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{spec ? spec.path : "Pick a file to preview"}</span>
          <button className="btn btn-ghost !h-7 !rounded-lg" onClick={() => openInCodeMode()} title="Open the full IDE">
            <Code2 size={13} /> Open in Code mode
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

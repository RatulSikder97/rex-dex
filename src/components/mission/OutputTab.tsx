"use client";
import OpenInApps from "@/components/OpenInApps";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Braces, Code2, ExternalLink, FileDiff, FileText, Film, GitBranch, ImageIcon, Music, PackageOpen, Shapes } from "lucide-react";
import { api, bytes, svgDataUrl, timeAgo } from "@/lib/client";
import type { Deliverable, DeliverableKind } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { Skeleton } from "@/components/ui/empty";
import { showActivity } from "@/components/workbench/actions";
import { useActiveProject, useDepartments } from "@/store/workbench";
import { useMissionData, type GitChange, type MediaFile } from "./data";
import { openInCodeMode, openPage } from "./nav";
import { PanelEmpty, Section, SectionAction } from "./ui";

const DiffView = dynamic(() => import("@/components/views/DiffView"), { ssr: false, loading: () => <Skeleton className="m-4 h-40" /> });

type Preview = { type: "deliverable"; d: Deliverable } | { type: "media"; m: MediaFile } | { type: "diff"; c: GitChange; staged: boolean };

const KIND_ICON: Record<DeliverableKind, typeof FileText> = { markdown: FileText, svg: Shapes, html: Code2, json: Braces };
const mediaUrl = (name: string) => `/api/media/${encodeURIComponent(name)}`;

// Deliverable bodies, cached per id+version so cards and previews share one fetch.
const contentCache = new Map<string, Promise<Deliverable>>();
function loadDeliverable(d: Deliverable): Promise<Deliverable> {
  const key = `${d.id}:${d.updated_at}`;
  let p = contentCache.get(key);
  if (!p) {
    p = api<Deliverable>(`/api/deliverables/${d.id}`);
    p.catch(() => contentCache.delete(key));
    contentCache.set(key, p);
  }
  return p;
}
function useDeliverable(d: Deliverable | null, enabled = true): Deliverable | null {
  const [full, setFull] = useState<Deliverable | null>(null);
  useEffect(() => {
    if (!d || !enabled) return;
    let live = true;
    loadDeliverable(d)
      .then((x) => live && setFull(x))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [d, enabled]);
  return full;
}

/** Strips Markdown syntax for a short plain-text excerpt. */
function excerpt(md: string, max = 180): string {
  const t = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Output: everything the agents produced — deliverables, media, repo changes — with in-panel previews. */
export default function OutputTab({ seenAt }: { seenAt: number }) {
  const project = useActiveProject();
  const { deliverables, media, git, loaded } = useMissionData();
  const [preview, setPreview] = useState<Preview | null>(null);
  const changes = git ? [...git.conflicts.map((c) => ({ c, staged: false })), ...git.staged.map((c) => ({ c, staged: true })), ...git.unstaged.map((c) => ({ c, staged: false }))] : [];

  if (preview) return <PreviewPane preview={preview} onBack={() => setPreview(null)} projectId={project?.id ?? null} />;

  if (loaded && !deliverables.length && !media.length && !changes.length)
    return <PanelEmpty icon={PackageOpen} title="No output yet" hint="Docs, graphics, media and repo changes from the departments collect here." />;

  return (
    <div className="space-y-6 px-4 pb-6 pt-4">
      <Section title="Deliverables" count={deliverables.length} hint="Docs, plans, copy and graphics saved by the departments.">
        {!loaded && <Skeleton className="h-28 rounded-xl" />}
        {loaded && !deliverables.length && <p className="rounded-[var(--rx-r-md)] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">Save an agent answer from the conversation to keep it here.</p>}
        <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
          {deliverables.slice(0, 24).map((d) => (
            <DeliverableCard key={d.id} d={d} isNew={d.updated_at > seenAt} onOpen={() => setPreview({ type: "deliverable", d })} />
          ))}
        </div>
      </Section>

      <Section title="Media" count={media.length} hint="Video, audio and images from Create Studio and the video tools.">
        {loaded && !media.length && <p className="rounded-[var(--rx-r-md)] border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">Videos, audio and images from the studios land here.</p>}
        <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3">
          {media.slice(0, 18).map((m) => (
            <MediaCard key={m.name} m={m} isNew={m.modified > seenAt} onOpen={() => setPreview({ type: "media", m })} />
          ))}
        </div>
      </Section>

      {project?.repo_path && (
        <Section
          title="Repo changes"
          count={changes.length}
          hint={git?.repo ? `Uncommitted files on ${git.branch ?? "HEAD"}` : "Not a git repository"}
          action={
            <SectionAction icon={GitBranch} onClick={() => (openInCodeMode(), showActivity("scm"))}>
              Source control
            </SectionAction>
          }
        >
          {git?.repo && !changes.length && <p className="text-[12.5px] text-muted">Working tree clean.</p>}
          <ul className="rx-card overflow-hidden">
            {changes.slice(0, 40).map(({ c, staged }) => (
              <li key={`${staged ? "s" : "w"}:${c.path}`} className="border-b border-line last:border-b-0">
                <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] hover:bg-hover" onClick={() => setPreview({ type: "diff", c, staged })}>
                  <FileDiff size={14} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.path}</span>
                  {staged && <span className="text-[10.5px] text-faint">staged</span>}
                  <StatusLetter s={c.status} />
                </button>
              </li>
            ))}
          </ul>
          {changes.length > 40 && <p className="mt-2 text-[12px] text-muted">{changes.length - 40} more in Source control.</p>}
        </Section>
      )}
    </div>
  );
}

function StatusLetter({ s }: { s: GitChange["status"] }) {
  const color = s === "A" || s === "?" ? "var(--ok)" : s === "D" ? "var(--err)" : s === "U" ? "var(--err)" : "var(--warn)";
  return (
    <span className="w-4 text-center font-mono text-[11px] font-semibold" style={{ color }} title={{ M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", U: "Conflict", T: "Type changed", "?": "Untracked" }[s]}>
      {s === "?" ? "U" : s}
    </span>
  );
}

function NewDot({ on }: { on: boolean }) {
  if (!on) return null;
  return <span className="rx-primary absolute right-2 top-2 z-10 rounded-full px-1.5 text-[9.5px] font-semibold uppercase leading-[15px] tracking-wide">new</span>;
}

function DeliverableCard({ d, isNew, onOpen }: { d: Deliverable; isNew: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && (setVisible(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const full = useDeliverable(d, visible);
  const { getDepartment } = useDepartments();
  const dept = getDepartment(d.department);
  const Icon = KIND_ICON[d.kind] ?? FileText;
  return (
    <button ref={ref} className="rx-card rx-hover rx-press relative flex flex-col overflow-hidden text-left" onClick={onOpen}>
      <NewDot on={isNew} />
      <div className="h-[104px] overflow-hidden border-b border-line bg-editor">
        {!full ? (
          <Skeleton className="m-3 h-[78px] rounded-lg" />
        ) : d.kind === "svg" ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL preview
          <img src={svgDataUrl(full.content)} alt="" className="h-full w-full object-contain p-2" />
        ) : (
          <p className="line-clamp-5 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">{d.kind === "markdown" ? excerpt(full.content) : full.content.slice(0, 300)}</p>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Icon size={14} className="shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium">{d.title}</div>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            <span style={{ color: dept.color }}>
              <DeptIcon name={dept.icon} size={11} />
            </span>
            <span className="truncate">{dept.name}</span> · <span className="shrink-0">{timeAgo(d.updated_at)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function MediaCard({ m, isNew, onOpen }: { m: MediaFile; isNew: boolean; onOpen: () => void }) {
  return (
    <button className="rx-card rx-hover rx-press relative flex flex-col overflow-hidden text-left" onClick={onOpen}>
      <NewDot on={isNew} />
      <div className="grid aspect-video place-items-center overflow-hidden border-b border-line bg-[color-mix(in_srgb,var(--bg)_70%,black)]">
        {m.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local media
          <img src={mediaUrl(m.name)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : m.kind === "video" ? (
          <video src={`${mediaUrl(m.name)}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
        ) : (
          <Music size={22} className="text-faint" />
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        {m.kind === "video" ? <Film size={12} className="shrink-0 text-faint" /> : m.kind === "audio" ? <Music size={12} className="shrink-0 text-faint" /> : <ImageIcon size={12} className="shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate text-[11.5px]" title={m.name}>
          {m.name}
        </span>
        <span className="shrink-0 text-[10.5px] text-faint">{bytes(m.size)}</span>
      </div>
    </button>
  );
}

function PreviewPane({ preview, onBack, projectId }: { preview: Preview; onBack: () => void; projectId: string | null }) {
  const full = useDeliverable(preview.type === "deliverable" ? preview.d : null);
  const title = preview.type === "deliverable" ? preview.d.title : preview.type === "media" ? preview.m.name : preview.c.path;
  const open = () => {
    if (preview.type === "deliverable") openPage({ kind: "deliverable", id: preview.d.id }, preview.d.title);
    else if (preview.type === "media") {
      if (preview.m.kind === "video") openPage({ kind: "video", file: preview.m.name }, "Video Studio");
      else window.open(mediaUrl(preview.m.name), "_blank", "noopener");
    } else if (projectId) openInCodeMode({ kind: "diff", projectId, path: preview.c.path, staged: preview.staged, from: preview.c.from }, `${preview.c.path.split("/").pop()} (diff)`);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <button className="icon-btn" onClick={onBack} aria-label="Back to output" title="Back to output">
          <ArrowLeft size={15} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        {preview.type === "media" && <OpenInApps media={preview.m.name} className="btn btn-ghost !h-7 !rounded-lg" />}
        <button className="btn btn-ghost !h-7 !rounded-lg" onClick={open}>
          <ExternalLink size={13} /> {preview.type === "diff" ? "Open in Code mode" : preview.type === "media" && preview.m.kind !== "video" ? "Open file" : "Open"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.type === "deliverable" &&
          (!full ? (
            <Skeleton className="m-5 h-40" />
          ) : full.kind === "svg" ? (
            <div className="grid min-h-full place-items-center bg-editor p-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
              <img src={svgDataUrl(full.content)} alt={full.title} className="max-h-[70vh] max-w-full" />
            </div>
          ) : full.kind === "html" ? (
            <iframe title={full.title} sandbox="" srcDoc={full.content} className="h-full min-h-[480px] w-full border-0 bg-white" />
          ) : full.kind === "json" ? (
            <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[12px]">{full.content}</pre>
          ) : (
            <div className="px-6 py-5">
              <Markdown text={full.content} />
            </div>
          ))}
        {preview.type === "media" && (
          <div className="grid min-h-full place-items-center bg-[color-mix(in_srgb,var(--bg)_70%,black)] p-5">
            {preview.m.kind === "video" ? (
              <video src={mediaUrl(preview.m.name)} controls className="max-h-[70vh] max-w-full rounded-lg" />
            ) : preview.m.kind === "audio" ? (
              <audio src={mediaUrl(preview.m.name)} controls className="w-full max-w-md" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local media
              <img src={mediaUrl(preview.m.name)} alt={preview.m.name} className="max-h-[70vh] max-w-full rounded-lg" />
            )}
          </div>
        )}
        {preview.type === "diff" && projectId && (
          <div className="h-full min-h-[420px]">
            <DiffView projectId={projectId} path={preview.c.path} staged={preview.staged} from={preview.c.from} />
          </div>
        )}
      </div>
    </div>
  );
}

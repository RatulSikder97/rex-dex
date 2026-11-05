"use client";
import OpenInApps from "@/components/OpenInApps";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Braces, Code2, ExternalLink, FileDiff, FileText, Film, GitBranch, ImageIcon, Music, PackageOpen, Shapes } from "lucide-react";
import { api, bytes, svgDataUrl, timeAgo } from "@/lib/client";
import type { Deliverable, DeliverableKind } from "@/lib/types";
import { DeptIcon } from "@/components/icons";
import Markdown from "@/components/Markdown";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { ErrorState, Pill } from "@/components/ui/kit";
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
function useDeliverable(d: Deliverable | null, enabled = true): { full: Deliverable | null; error: string | null; retry: () => void } {
  const [full, setFull] = useState<Deliverable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!d || !enabled) return;
    let live = true;
    setError(null);
    loadDeliverable(d)
      .then((x) => live && setFull(x))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [d, enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { full, error, retry };
}

const DELIVERABLE_PAGE = 24;
const MEDIA_PAGE = 18;
const CHANGES_PAGE = 40;

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
  const [dCap, setDCap] = useState(DELIVERABLE_PAGE);
  const [mCap, setMCap] = useState(MEDIA_PAGE);
  const changes = git ? [...git.conflicts.map((c) => ({ c, staged: false })), ...git.staged.map((c) => ({ c, staged: true })), ...git.unstaged.map((c) => ({ c, staged: false }))] : [];

  if (preview) return <PreviewPane preview={preview} onBack={() => setPreview(null)} projectId={project?.id ?? null} />;

  if (loaded && !deliverables.length && !media.length && !changes.length)
    return <PanelEmpty icon={PackageOpen} title="No output yet" hint="Docs, graphics, media and repo changes from the departments collect here." />;

  return (
    <div className="@container space-y-6 px-4 pb-6 pt-3">
      <Section title="Deliverables" count={deliverables.length} hint="Docs, plans, copy and graphics saved by the departments.">
        {!loaded ? (
          <div className="grid grid-cols-1 gap-2 @md:grid-cols-2" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-[152px]" />
            <Skeleton className="h-[152px]" />
          </div>
        ) : !deliverables.length ? (
          <EmptyState compact icon={FileText} title="No deliverables yet" hint="Save an agent answer from the task to keep it here." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
              {deliverables.slice(0, dCap).map((d) => (
                <DeliverableCard key={d.id} d={d} isNew={d.updated_at > seenAt} onOpen={() => setPreview({ type: "deliverable", d })} />
              ))}
            </div>
            {deliverables.length > dCap && (
              <button type="button" className="btn btn-ghost btn-sm -ml-2 mt-2" onClick={() => setDCap((n) => n + DELIVERABLE_PAGE)}>
                Show more ({deliverables.length - dCap})
              </button>
            )}
          </>
        )}
      </Section>

      <Section title="Media" count={media.length} hint="Video, audio and images from Create Studio and the video tools.">
        {!loaded ? (
          <div className="grid grid-cols-2 gap-2 @md:grid-cols-3" aria-busy="true" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-video" />
            ))}
          </div>
        ) : !media.length ? (
          <EmptyState compact icon={Film} title="No media yet" hint="Videos, audio and images from the studios land here." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
              {media.slice(0, mCap).map((m) => (
                <MediaCard key={m.name} m={m} isNew={m.modified > seenAt} onOpen={() => setPreview({ type: "media", m })} />
              ))}
            </div>
            {media.length > mCap && (
              <button type="button" className="btn btn-ghost btn-sm -ml-2 mt-2" onClick={() => setMCap((n) => n + MEDIA_PAGE)}>
                Show more ({media.length - mCap})
              </button>
            )}
          </>
        )}
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
          {!loaded ? (
            <div className="skeleton h-7" aria-hidden />
          ) : !git?.repo ? (
            <p className="text-[12px] text-muted">This folder isn&apos;t a git repository.</p>
          ) : !changes.length ? (
            <p className="text-[12px] text-muted">Working tree clean.</p>
          ) : (
            <ul className="-mx-4">
              {changes.slice(0, CHANGES_PAGE).map(({ c, staged }) => (
                <li key={`${staged ? "s" : "w"}:${c.path}`}>
                  <button type="button" className="flex h-7 w-full items-center gap-2 px-4 text-left hover:bg-hover" onClick={() => setPreview({ type: "diff", c, staged })} title={c.path}>
                    <FileDiff size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.path}</span>
                    {staged && <span className="text-[11px] text-faint">Staged</span>}
                    <StatusLetter s={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {changes.length > CHANGES_PAGE && <p className="mt-2 text-[12px] text-muted">{changes.length - CHANGES_PAGE} more in Source control.</p>}
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
  return (
    <Pill tone="accent" className="absolute right-1.5 top-1.5 z-10 !bg-[color:color-mix(in_srgb,var(--accent)_22%,var(--bg-elev))]" title="Added since you last opened Output">
      New
    </Pill>
  );
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
  const { full, error } = useDeliverable(d, visible);
  const { getDepartment } = useDepartments();
  const dept = getDepartment(d.department);
  const Icon = KIND_ICON[d.kind] ?? FileText;
  return (
    <button ref={ref} type="button" className="card relative flex flex-col overflow-hidden text-left transition-colors hover:border-[color:color-mix(in_srgb,var(--fg-faint)_60%,var(--border))]" onClick={onOpen} title={d.title}>
      <NewDot on={isNew} />
      <div className="h-[104px] overflow-hidden border-b border-line bg-editor">
        {error ? (
          <p className="px-3 py-2.5 text-[11.5px] text-muted">Preview unavailable. Open it to retry.</p>
        ) : !full ? (
          <Skeleton className="m-3 h-[78px]" />
        ) : d.kind === "svg" ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL preview
          <img src={svgDataUrl(full.content)} alt="" className="h-full w-full object-contain p-2" />
        ) : (
          <p className="line-clamp-5 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">{d.kind === "markdown" ? excerpt(full.content) : full.content.slice(0, 300)}</p>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon size={14} className="shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{d.title}</div>
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
    <button type="button" className="card relative flex flex-col overflow-hidden text-left transition-colors hover:border-[color:color-mix(in_srgb,var(--fg-faint)_60%,var(--border))]" onClick={onOpen} title={m.name}>
      <NewDot on={isNew} />
      <div className="grid aspect-video place-items-center overflow-hidden border-b border-line bg-bg">
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
        <span className="min-w-0 flex-1 truncate text-[12px]">
          {m.name}
        </span>
        <span className="shrink-0 text-[11px] text-faint">{bytes(m.size)}</span>
      </div>
    </button>
  );
}

function PreviewPane({ preview, onBack, projectId }: { preview: Preview; onBack: () => void; projectId: string | null }) {
  const { full, error, retry } = useDeliverable(preview.type === "deliverable" ? preview.d : null);
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
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2">
        <button className="icon-btn" onClick={onBack} aria-label="Back to output" title="Back to output">
          <ArrowLeft size={15} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={title}>
          {title}
        </span>
        {preview.type === "media" && <OpenInApps media={preview.m.name} className="btn btn-ghost btn-sm" />}
        <button type="button" className="btn btn-sm" onClick={open}>
          <ExternalLink size={13} /> {preview.type === "diff" ? "Open in Code mode" : preview.type === "media" && preview.m.kind !== "video" ? "Open file" : "Open"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.type === "deliverable" &&
          (error && !full ? (
            <ErrorState title="Couldn’t load this deliverable" error={`${error}. Check that REX is running, then retry.`} onRetry={retry} />
          ) : !full ? (
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
          <div className="grid min-h-full place-items-center bg-bg p-5">
            {preview.m.kind === "video" ? (
              <video src={mediaUrl(preview.m.name)} controls className="max-h-[70vh] max-w-full rounded-[6px]" />
            ) : preview.m.kind === "audio" ? (
              <audio src={mediaUrl(preview.m.name)} controls className="w-full max-w-md" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local media
              <img src={mediaUrl(preview.m.name)} alt={preview.m.name} className="max-h-[70vh] max-w-full rounded-[6px]" />
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

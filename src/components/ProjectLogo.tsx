"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImageUp, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { api, svgDataUrl } from "@/lib/client";
import type { Project } from "@/lib/types";
import { useWorkbench } from "@/store/workbench";

/** Project mark: its logo (AI-generated or uploaded) or a monogram fallback. */
export function ProjectAvatar({ project, size = 28, className = "", onClick }: { project: Pick<Project, "name" | "logo"> | null | undefined; size?: number; className?: string; onClick?: () => void }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  const inner = project?.logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- data URL of sanitized SVG
    <img src={svgDataUrl(project.logo)} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <span className="font-semibold text-accent" style={{ fontSize: Math.round(size * 0.44) }}>
      {(project?.name ?? "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden bg-accent/15 ring-1 ring-inset ring-line ${className}`;
  return onClick ? (
    <button type="button" className={`${cls} transition-transform hover:scale-105`} style={style} onClick={onClick} title="Project logo" aria-label="Project logo">
      {inner}
    </button>
  ) : (
    <span className={cls} style={style} aria-hidden>
      {inner}
    </span>
  );
}

// ---------------------------------------------------------------- Logo Studio

let opener: ((projectId: string) => void) | null = null;
/** Opens the Logo Studio for a project (generate with the Design agent, pick, upload). */
export function openLogoStudio(projectId?: string | null) {
  const id = projectId ?? useWorkbench.getState().projectId;
  if (id) opener?.(id);
}

export function LogoStudioHost() {
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    opener = setProjectId;
    return () => {
      opener = null;
    };
  }, []);
  return projectId ? <LogoStudio key={projectId} projectId={projectId} onClose={() => setProjectId(null)} /> : null;
}

function LogoStudio({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { projects, loadProjects, log } = useWorkbench();
  const project = projects.find((p) => p.id === projectId);
  const [options, setOptions] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<"gen" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (busy !== "gen") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const generate = async () => {
    setBusy("gen");
    setError(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const r = await api<{ options: string[] }>(`/api/projects/${projectId}/logo`, { method: "POST", json: { hint: hint.trim() || undefined } });
      setOptions(r.options);
      setPicked(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async (svg: string) => {
    setBusy("save");
    try {
      await api(`/api/projects/${projectId}/logo`, { method: "PUT", json: { svg } });
      await loadProjects();
      log("ok", "projects", svg ? `New logo for ${project?.name}` : `Removed the logo of ${project?.name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 400_000) return setError("Image too large (max 400 KB)");
    if (f.type === "image/svg+xml") return void save(await f.text());
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(f);
    });
    void save(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image href="${dataUrl}" width="256" height="256" preserveAspectRatio="xMidYMid slice"/></svg>`);
  };

  const elapsed = busy === "gen" ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} role="dialog" aria-modal="true" aria-label="Project logo">
      <div className="w-[min(640px,96vw)] overflow-hidden rounded-xl border border-line bg-elev shadow-[0_24px_64px_rgba(0,0,0,.5)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <ProjectAvatar project={project} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Logo for {project?.name ?? "project"}</h2>
            <p className="text-[12px] text-muted">The Design department drafts a few marks; pick one, or upload your own.</p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={!!busy} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex gap-2">
            <input
              className="input h-9 !rounded-lg"
              placeholder="Style hint (optional): e.g. minimal geometric, warm orange, rocket"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void generate()}
              aria-label="Style hint"
            />
            <button className="btn btn-primary h-9 shrink-0 !rounded-lg" onClick={() => void generate()} disabled={!!busy}>
              {options.length ? <RefreshCw size={14} className={busy === "gen" ? "animate-spin" : ""} /> : <Sparkles size={14} />}
              {busy === "gen" ? `Designing… ${elapsed}s` : options.length ? "Regenerate" : "Generate logos"}
            </button>
          </div>

          {busy === "gen" && !options.length && (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-hover" />
              ))}
            </div>
          )}

          {!!options.length && (
            <div className={`grid grid-cols-3 gap-3 ${busy === "gen" ? "opacity-50" : ""}`} role="radiogroup" aria-label="Logo options">
              {options.map((svg, i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={picked === i}
                  onClick={() => setPicked(i)}
                  onDoubleClick={() => void save(svg)}
                  className={`group relative aspect-square overflow-hidden rounded-xl border-2 bg-bg p-3 transition-all hover:-translate-y-0.5 ${picked === i ? "border-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_20%,transparent)]" : "border-line hover:border-faint"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL of sanitized SVG */}
                  <img src={svgDataUrl(svg)} alt={`Logo option ${i + 1}`} className="h-full w-full rounded-lg object-contain" />
                  <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-elev/90 px-1.5 py-0.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- favicon-size preview */}
                    <img src={svgDataUrl(svg)} alt="" className="h-4 w-4 rounded-[3px]" />
                    {picked === i && <Check size={11} className="text-accent" />}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!options.length && busy !== "gen" && (
            <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted">
              Generate three concepts from your project&apos;s name and description, or upload an SVG / PNG.
            </div>
          )}
          {error && <div className="rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-[12px] text-err">{error}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <input ref={file} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <button className="btn h-8 !rounded-lg" onClick={() => file.current?.click()} disabled={!!busy}>
            <ImageUp size={14} /> Upload
          </button>
          {project?.logo && (
            <button className="btn h-8 !rounded-lg" onClick={() => void save("")} disabled={!!busy}>
              <Trash2 size={13} /> Remove
            </button>
          )}
          <div className="flex-1" />
          <button className="btn h-8 !rounded-lg" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button className="btn btn-primary h-8 !rounded-lg" disabled={picked === null || !options[picked ?? -1] || !!busy} onClick={() => picked !== null && void save(options[picked])}>
            <Check size={14} /> Use this logo
          </button>
        </div>
      </div>
    </div>
  );
}

/** Browser tab icon = active project's logo (falls back to the REX icon). */
export function useProjectFavicon() {
  const project = useWorkbench((s) => s.projects.find((p) => p.id === s.projectId));
  const logo = project?.logo ?? "";
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? Object.assign(document.createElement("link"), { rel: "icon" });
    if (!link.parentNode) document.head.appendChild(link);
    const fallback = link.dataset.rexDefault ?? link.href;
    link.dataset.rexDefault = fallback;
    link.href = logo ? svgDataUrl(logo) : fallback;
  }, [logo]);
}

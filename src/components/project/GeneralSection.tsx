"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, ImageUp, Sparkles, Trash2 } from "lucide-react";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { api } from "@/lib/client";
import { STAGES, type Project } from "@/lib/types";
import { useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";
import { pickFolder } from "@/components/ui/FolderPicker";
import { Spinner, errMsg } from "@/components/ops/shared";

type Draft = Pick<Project, "name" | "description" | "stage" | "website_url" | "repo_path">;
const draftOf = (p: Project): Draft => ({ name: p.name, description: p.description, stage: p.stage, website_url: p.website_url, repo_path: p.repo_path });

export type GeneralField = "website" | "repo";

/** Name, description, stage, website and repository folder; plus deleting the project. */
export default function GeneralSection({ project, focus, onSaved }: { project: Project; focus?: { field: GeneralField; key: number } | null; onSaved: () => void }) {
  const { loadProjects, closeTab, log } = useWorkbench();
  const [d, setD] = useState<Draft>(() => draftOf(project));
  const [saving, setSaving] = useState(false);
  const websiteRef = useRef<HTMLInputElement>(null);
  const repoRef = useRef<HTMLInputElement>(null);
  const saved = draftOf(project);
  const dirty = (Object.keys(saved) as (keyof Draft)[]).some((k) => String(d[k]).trim() !== String(saved[k]).trim());

  // Pick up saves made elsewhere (title bar rename, clone changing repo_path) when nothing is being edited.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setD(draftOf(project));
  }, [project]);

  useEffect(() => {
    if (!focus) return;
    const el = focus.field === "website" ? websiteRef.current : repoRef.current;
    requestAnimationFrame(() => {
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    });
  }, [focus]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!d.name.trim()) return log("error", "project", "Name can't be empty");
    setSaving(true);
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        json: { name: d.name.trim(), description: d.description, stage: d.stage, repo_path: d.repo_path.trim(), website_url: d.website_url.trim() },
      });
      await loadProjects();
      onSaved();
      log("ok", "project", `Saved ${d.name.trim()}`);
    } catch (e) {
      log("error", "project", errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const choose = async () => {
    const cur = d.repo_path.trim();
    const path = await pickFolder({ title: "Repository folder", message: "Engineering and QA agents run in this folder.", startIn: cur || null, confirmLabel: "Use this folder" });
    if (path) set("repo_path", path);
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete project "${project.name}"?`, message: "All its tasks and deliverables are deleted too. Files in the linked repository are not touched. This cannot be undone.", confirmLabel: "Delete project", danger: true }))) return;
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      await loadProjects();
      closeTab(`project:${project.id}`);
      closeTab(`board:${project.id}`);
      log("ok", "project", `Deleted ${project.name}`);
    } catch (e) {
      log("error", "project", errMsg(e));
    }
  };

  const stageLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

  return (
    <div className="max-w-[720px] space-y-8">
      <form
        className="space-y-5"
        aria-label="Project details"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        <div className="field">
          <span className="label" id="hub-logo-label">
            Logo
          </span>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="hub-logo-label">
            <ProjectAvatar project={project} size={32} onClick={() => openLogoStudio(project.id)} />
            <button type="button" className="btn btn-sm" onClick={() => openLogoStudio(project.id)}>
              <Sparkles size={12} aria-hidden /> Generate…
            </button>
            <button type="button" className="btn btn-sm" onClick={() => openLogoStudio(project.id)}>
              <ImageUp size={12} aria-hidden /> Upload…
            </button>
          </div>
          <p className="help">Shown in the title bar, the rail and the browser tab.</p>
        </div>

        <label className="field">
          <span className="label">Name</span>
          <input className="input" required value={d.name} onChange={(e) => set("name", e.target.value)} />
        </label>

        <label className="field">
          <span className="label">Description</span>
          <textarea className="input" rows={5} value={d.description} onChange={(e) => set("description", e.target.value)} aria-describedby="hub-desc-help" />
          <span id="hub-desc-help" className="help">
            What it is, who it&apos;s for and why it wins. Every agent reads this.
          </span>
        </label>

        <div className="grid grid-cols-1 gap-5 @xl:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <label className="field">
            <span className="label">Stage</span>
            <select className="input" value={d.stage} onChange={(e) => set("stage", e.target.value as Project["stage"])}>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {stageLabel(st)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Website</span>
            <input ref={websiteRef} className="input font-mono" placeholder="https://…" value={d.website_url} onChange={(e) => set("website_url", e.target.value)} aria-describedby="hub-site-help" />
            <span id="hub-site-help" className="help">
              Used by the SEO &amp; AEO agents and by uptime monitors.
            </span>
          </label>
        </div>

        <div className="field">
          <label htmlFor="hub-repo-path" className="label">
            Repository folder
          </label>
          <div className="flex gap-2">
            <input id="hub-repo-path" ref={repoRef} className="input min-w-0 flex-1 font-mono" placeholder="/Users/you/projects/my-app" value={d.repo_path} onChange={(e) => set("repo_path", e.target.value)} aria-describedby="hub-repo-help" />
            <button type="button" className="btn shrink-0" onClick={() => void choose()}>
              <FolderOpen size={12} aria-hidden /> Choose…
            </button>
          </div>
          <p id="hub-repo-help" className="help">
            Engineering and QA agents run in this folder.{!d.repo_path.trim() && " No folder yet? Clone a repository from the Repository section."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {dirty && <span className="mr-auto text-[12px] text-faint">Unsaved changes</span>}
          {dirty && (
            <button type="button" className="btn" onClick={() => setD(draftOf(project))} disabled={saving}>
              Discard
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving && <Spinner />} {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <section className="min-w-0" aria-labelledby="hub-danger">
        <h3 id="hub-danger" className="mb-2 text-[13px] font-semibold">
          Danger zone
        </h3>
        <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-[color-mix(in_srgb,var(--err)_35%,var(--border))] px-3 py-2.5">
          <div className="min-w-[200px] flex-1">
            <div className="text-[13px] font-medium">Delete this project</div>
            <p className="text-[12px] text-muted">Deletes its tasks and deliverables. Files in the repository folder aren&apos;t touched.</p>
          </div>
          <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void remove()}>
            <Trash2 size={12} aria-hidden /> Delete project…
          </button>
        </div>
      </section>
    </div>
  );
}

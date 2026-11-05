"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, ImageUp, Settings2, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { ProjectAvatar, openLogoStudio } from "@/components/ProjectLogo";
import { api } from "@/lib/client";
import { STAGES, type Project } from "@/lib/types";
import { useWorkbench } from "@/store/workbench";
import { confirmDialog } from "@/components/ui/dialog";
import { pickFolder } from "@/components/ui/FolderPicker";
import { Card, Spinner, errMsg } from "@/components/ops/shared";

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

  return (
    <div className="space-y-4">
      <Card title="Project details" icon={<Settings2 size={14} />}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) void save();
          }}
        >
          <div>
            <span className="label" id="hub-logo-label">Logo</span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="hub-logo-label">
              <ProjectAvatar project={project} size={40} onClick={() => openLogoStudio(project.id)} />
              <button type="button" className="btn h-7" onClick={() => openLogoStudio(project.id)}>
                <Sparkles size={12} /> Generate…
              </button>
              <button type="button" className="btn h-7" onClick={() => openLogoStudio(project.id)}>
                <ImageUp size={12} /> Upload…
              </button>
              <span className="text-[11.5px] text-faint">Shown in the title bar, the rail and the browser tab.</span>
            </div>
          </div>
          <label className="block">
            <span className="label">Name</span>
            <input className="input" required value={d.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Description: what it is, who it&apos;s for, why it wins (every agent reads this)</span>
            <textarea className="input" rows={6} value={d.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
            <label className="block">
              <span className="label">Stage</span>
              <select className="input" value={d.stage} onChange={(e) => set("stage", e.target.value as Project["stage"])}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Website URL (used by SEO/AEO and uptime)</span>
              <input ref={websiteRef} className="input font-mono" placeholder="https://…" value={d.website_url} onChange={(e) => set("website_url", e.target.value)} />
            </label>
          </div>
          <div>
            <label htmlFor="hub-repo-path" className="label">
              Repository folder (absolute path; Engineering and QA agents run here)
            </label>
            <div className="flex gap-2">
              <input id="hub-repo-path" ref={repoRef} className="input min-w-0 flex-1 font-mono" placeholder="/Users/you/EASITAL/my-app" value={d.repo_path} onChange={(e) => set("repo_path", e.target.value)} />
              <button type="button" className="btn h-7 shrink-0" onClick={() => void choose()}>
                <FolderOpen size={12} /> Choose…
              </button>
            </div>
            {!d.repo_path.trim() && <p className="mt-1 text-[11.5px] text-faint">No folder yet? Clone a repository from Repository &amp; Git.</p>}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
              {saving && <Spinner />} {saving ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button type="button" className="btn" onClick={() => setD(draftOf(project))} disabled={saving}>
                Discard
              </button>
            )}
            {dirty && <span className="text-[11.5px] text-faint">Unsaved changes</span>}
          </div>
        </form>
      </Card>

      <section className="min-w-0 rounded-xl border border-err/35 bg-err/5 p-3.5" aria-labelledby="hub-danger">
        <h3 id="hub-danger" className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-err">
          <TriangleAlert size={14} /> Danger zone
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[12px] text-muted">Deletes the project with its tasks and deliverables. Files in the repository folder stay untouched.</p>
          <button type="button" className="btn text-err" onClick={() => void remove()}>
            <Trash2 size={13} /> Delete project
          </button>
        </div>
      </section>
    </div>
  );
}

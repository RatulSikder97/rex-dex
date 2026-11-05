"use client";
import { useEffect, useState } from "react";
import { CircleDot, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Link2, PlayCircle } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { GitInfo } from "@/lib/opsTypes";
import { EmptyState } from "@/components/ui/empty";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { openProjectHub } from "@/components/workbench/actions";
import { Card, CopyButton, ErrorBox, LoadingGrid, Pill, Sentence, Spinner, errMsg, friendlyError, useOpsFetch, type OpsNav, type Tone } from "./shared";

export function runTone(r: { status: string; conclusion: string | null }): Tone {
  if (r.status !== "completed") return "accent";
  if (r.conclusion === "success") return "ok";
  if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") return "err";
  if (r.conclusion === "cancelled") return "warn";
  return "muted";
}

const GH_SETUP = "brew install gh && gh auth login";

export default function GitSection({ nav }: { nav: OpsNav }) {
  const url = nav.projectId ? `/api/ops/git?projectId=${encodeURIComponent(nav.projectId)}` : null;
  const { data: g, error, loaded, reload } = useOpsFetch<GitInfo | null>(url, nav.reloadKey);

  return (
    <div className="space-y-4">
      <LinksEditor />
      {!nav.projectId ? (
        <Card>
          <EmptyState icon={GitBranch} title="No project selected" hint="Pick or create a project to see its repository." />
        </Card>
      ) : !loaded ? (
        <LoadingGrid n={4} />
      ) : error && g === null ? (
        <ErrorBox title="Couldn't read the repository" error={error} onRetry={() => void reload()} />
      ) : !g ? (
        <Card>
          <EmptyState icon={GitBranch} title="No git repository" hint="This project's folder isn't a git repository yet. Initialize it or clone one from the project hub." action={{ label: "Connect repository", onClick: () => openProjectHub(nav.projectId!, "git", "connect-repo") }} />
        </Card>
      ) : (
        <GitPanels g={g} />
      )}
    </div>
  );
}

/** Repository / commits / PRs / CI / issues cards. `hideRepository` drops the branch + remotes card (the Project hub renders its own). */
export function GitPanels({ g, hideRepository = false }: { g: GitInfo; hideRepository?: boolean }) {
  const web = g.remotes.find((r) => r.webUrl)?.webUrl ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      {!hideRepository && (
      <Card title="Repository" icon={<GitBranch size={13} />}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-mono font-medium">{g.branch ?? "detached HEAD"}</span>
          {g.ahead > 0 && <Pill tone="accent">{g.ahead} ahead</Pill>}
          {g.behind > 0 && <Pill tone="warn">{g.behind} behind</Pill>}
          {!g.ahead && !g.behind && <Pill tone="ok">In sync</Pill>}
        </div>
        {g.remotes.length ? (
          <ul className="space-y-1.5 text-[12px]">
            {g.remotes.map((r) => (
              <li key={r.name} className="flex min-w-0 items-center gap-2">
                <span className="w-16 shrink-0 font-medium">{r.name}</span>
                {r.webUrl ? (
                  <a href={r.webUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-accent hover:underline" title={r.url}>
                    <span className="truncate">{r.webUrl.replace(/^https?:\/\//, "")}</span>
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                ) : (
                  <span className="truncate font-mono text-[11.5px] text-muted" title={r.url}>
                    {r.url}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted">No remotes yet. Connect one from the project hub.</p>
        )}
      </Card>
      )}

      <Card title="Recent commits" icon={<GitCommitHorizontal size={13} />}>
        {g.commits.length ? (
          <ul className="space-y-1 text-[12px]">
            {g.commits.slice(0, 12).map((c) => {
              const short = c.hash.slice(0, 7);
              return (
                <li key={c.hash} className="flex h-6 min-w-0 items-center gap-2">
                  {web ? (
                    <a href={`${web}/commit/${c.hash}`} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[11px] text-accent hover:underline">
                      {short}
                    </a>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-muted">{short}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={c.subject}>
                    {c.subject}
                  </span>
                  <span className="hidden shrink-0 truncate text-[11px] text-muted @2xl:inline">{c.author}</span>
                  <span className="shrink-0 text-[11px] text-faint">{timeAgo(c.at)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-muted">No commits yet.</p>
        )}
      </Card>

      {!g.gh.available ? (
        <Card title="GitHub" icon={<GitPullRequest size={13} />} className="@4xl:col-span-2" action={<Pill tone="muted">Not set up</Pill>}>
          <div className="space-y-2 text-[12px] text-muted">
            <p>Pull requests, CI runs and issues come from the GitHub CLI. Install it and sign in:</p>
            <div className="flex flex-wrap items-center gap-1">
              <code className="rounded-[4px] border border-line bg-editor px-2 py-1 font-mono text-[12px] text-fg">{GH_SETUP}</code>
              <CopyButton text={GH_SETUP} label="Copy command" iconOnly />
            </div>
            {g.gh.error && (
              <p className="break-words text-[12px] text-faint" title={g.gh.error}>
                <Sentence text={friendlyError(g.gh.error).text} />
              </p>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card title="Open pull requests" icon={<GitPullRequest size={13} />} action={<span className="count">{g.gh.prs.length}</span>}>
            {g.gh.prs.length ? (
              <ul className="space-y-1 text-[12px]">
                {g.gh.prs.map((p) => (
                  <li key={p.number} className="flex h-6 min-w-0 items-center gap-2">
                    <span className="shrink-0 tabular-nums text-muted">#{p.number}</span>
                    <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent hover:underline" title={p.title}>
                      {p.title}
                    </a>
                    {p.draft && <Pill tone="muted">Draft</Pill>}
                    <span className="shrink-0 text-[11px] text-faint">{p.author}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No open pull requests.</p>
            )}
          </Card>
          <Card title="CI runs" icon={<PlayCircle size={13} />}>
            {g.gh.runs.length ? (
              <ul className="space-y-1 text-[12px]">
                {g.gh.runs.slice(0, 10).map((r, i) => (
                  <li key={i} className="flex h-6 min-w-0 items-center gap-2">
                    <Pill tone={runTone(r)}>{r.status === "completed" ? (r.conclusion ?? "done") : r.status.replace(/_/g, " ")}</Pill>
                    <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent hover:underline" title={r.name}>
                      {r.name}
                    </a>
                    <span className="max-w-[120px] shrink-0 truncate font-mono text-[11px] text-muted">{r.branch}</span>
                    <span className="shrink-0 text-[11px] text-faint">{timeAgo(r.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No workflow runs. GitHub Actions may not be set up for this repository.</p>
            )}
          </Card>
          <Card title="Open issues" icon={<CircleDot size={13} />} className="@4xl:col-span-2" action={<span className="count">{g.gh.issues.length}</span>}>
            {g.gh.issues.length ? (
              <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] @4xl:grid-cols-2">
                {g.gh.issues.map((s) => (
                  <li key={s.number} className="flex h-6 min-w-0 items-center gap-2">
                    <span className="shrink-0 tabular-nums text-muted">#{s.number}</span>
                    <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent hover:underline" title={s.title}>
                      {s.title}
                    </a>
                    <span className="shrink-0 text-[11px] text-faint">{s.author}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No open issues.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Project links: website URL (used by Uptime, SEO and the agents). */
function LinksEditor() {
  const project = useActiveProject();
  const { log, loadProjects } = useWorkbench();
  const [site, setSite] = useState(project?.website_url ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setSite(project?.website_url ?? ""), [project?.id, project?.website_url]);
  if (!project) return null;
  const dirty = site.trim() !== (project.website_url ?? "");

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", json: { website_url: site.trim() } });
      await loadProjects();
      log("ok", "ops", "Saved project website");
    } catch (e) {
      log("error", "ops", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const href = site.trim() ? (/^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`) : null;
  return (
    <Card title="Project links" icon={<Link2 size={13} />}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        <label className="field min-w-[220px] flex-1">
          <span className="label">Website</span>
          <input className="input font-mono" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://yourproduct.com" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>
          {busy && <Spinner />} Save
        </button>
        {href && !dirty && (
          <a className="btn" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> Open
          </a>
        )}
      </form>
      <p className="help">Used by uptime monitors and the SEO &amp; AEO agents.</p>
      {project.repo_path && (
        <p className="mt-2 truncate font-mono text-[12px] text-faint" title={project.repo_path}>
          {project.repo_path}
        </p>
      )}
    </Card>
  );
}

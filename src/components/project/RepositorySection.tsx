"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CloudDownload, ExternalLink, FolderGit2, FolderOpen, GitBranch, GitPullRequestCreate, Link2, Pencil, Plug, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import type { GitInfo } from "@/lib/opsTypes";
import type { Project } from "@/lib/types";
import { useWorkbench } from "@/store/workbench";
import { confirmDialog, promptDialog } from "@/components/ui/dialog";
import { pickFolder } from "@/components/ui/FolderPicker";
import { EmptyState } from "@/components/ui/empty";
import { GitPanels } from "@/components/ops/GitSection";
import { Card, CopyButton, ErrorBox, LoadingGrid, Pill, Spinner, errMsg } from "@/components/ops/shared";
import { Segmented } from "@/components/ui/kit";

type GitAction =
  | { action: "init" }
  | { action: "set-remote"; url: string; name?: string }
  | { action: "remove-remote"; name: string }
  | { action: "clone"; url: string; folder: string }
  | { action: "create-github"; name: string; visibility: "private" | "public"; description?: string }
  | { action: "fetch" | "pull" | "push" };

type Mode = "remote" | "github" | "clone" | "init";

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "project";
const repoNameFromUrl = (u: string) => u.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
const parentOf = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || null;
const REMOTE_RE = /^(https:\/\/|git@|ssh:\/\/)\S+$/;

interface Fetched {
  data: GitInfo | null;
  error: string | null;
  loaded: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Repository & Git: status, connect (remote / GitHub / clone / init), remotes, fetch / pull / push. */
export default function RepositorySection({ project, git, connectKey, onLinkFolder }: { project: Project; git: Fetched; connectKey?: number; onLinkFolder: () => void }) {
  const { log, loadProjects, bump } = useWorkbench();
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<{ title: string; text: string; ok: boolean } | null>(null);
  const g = git.data;
  const hasRepo = !!project.repo_path;

  const run = async (label: string, op: GitAction): Promise<boolean> => {
    setBusy(label);
    try {
      const r = await api<{ ok: true; output: string; repoPath?: string }>(`/api/projects/${project.id}/git`, { method: "POST", json: op });
      setOut({ title: label, text: r.output || "done", ok: true });
      log("ok", "git", label);
      if (op.action === "clone" || r.repoPath) await loadProjects();
      bump();
      await git.reload();
      return true;
    } catch (e) {
      setOut({ title: `${label} failed`, text: errMsg(e), ok: false });
      log("error", "git", errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const changeRemote = async (name: string, url: string) => {
    const next = await promptDialog({ title: `Change ${name} URL`, message: "https://, git@ or ssh:// repository URL", initial: url, confirmLabel: "Save" });
    if (next && next.trim() !== url) await run(`Changed ${name}`, { action: "set-remote", name, url: next.trim() });
  };
  const removeRemote = async (name: string) => {
    if (!(await confirmDialog({ title: `Remove remote ${name}?`, message: "Only the link is removed (git remote remove). Nothing on the server is deleted.", confirmLabel: "Remove remote", danger: true }))) return;
    await run(`Removed ${name}`, { action: "remove-remote", name });
  };
  const push = async () => {
    const target = g?.remotes.find((r) => r.name === "origin") ?? g?.remotes[0];
    if (!(await confirmDialog({ title: `Push ${g?.branch ?? "HEAD"} to origin?`, message: `Runs git push -u origin HEAD${target ? ` → ${target.url}` : ""}.`, confirmLabel: "Push" }))) return;
    await run("Pushed", { action: "push" });
  };

  return (
    <div className="space-y-4">
      {!hasRepo ? (
        <Card>
          <EmptyState
            icon={FolderGit2}
            title="No repository folder linked"
            hint="Link the folder this project lives in (General → Repository folder), or clone a repository into a new folder below."
            action={{ label: "Link a folder", icon: FolderOpen, onClick: onLinkFolder }}
          />
        </Card>
      ) : !git.loaded ? (
        <LoadingGrid n={2} h="h-24" />
      ) : git.error && !g ? (
        <ErrorBox title="Couldn't read the repository" error={git.error} onRetry={() => void git.reload()} />
      ) : !g ? (
        <Card title="Not a git repository yet" icon={<GitBranch size={13} />} action={<Pill tone="warn">No git</Pill>}>
          <p className="break-words text-[12px] text-muted">
            <span className="font-mono text-fg">{project.repo_path}</span> isn&apos;t under git. Initialize it here, or clone an existing repository.
          </p>
        </Card>
      ) : (
        <StatusCard g={g} busy={busy} onRefresh={() => void git.reload()} refreshing={git.loading} onChange={changeRemote} onRemove={removeRemote} onSync={(a) => (a === "push" ? void push() : void run(a === "fetch" ? "Fetched" : "Pulled", { action: a }))} />
      )}

      <ConnectCard project={project} g={g} gitLoaded={git.loaded || !hasRepo} busy={busy} run={run} focusKey={connectKey} />

      {out && (
        <section aria-label="Command output" className={`card ${out.ok ? "" : "!border-[color-mix(in_srgb,var(--err)_40%,var(--border))]"}`}>
          <header className="card-head">
            <SquareTerminal size={13} className={`shrink-0 ${out.ok ? "text-muted" : "text-err"}`} aria-hidden />
            <h3 className={`min-w-0 flex-1 truncate ${out.ok ? "" : "text-err"}`} title={out.title}>
              {out.title}
            </h3>
            <CopyButton text={out.text} label="Copy output" iconOnly />
            <button className="btn btn-sm font-normal" onClick={() => setOut(null)}>
              Clear
            </button>
          </header>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-editor p-3 font-mono text-[11.5px] leading-relaxed">{out.text}</pre>
        </section>
      )}

      {g && <GitPanels g={g} hideRepository />}
    </div>
  );
}

function StatusCard({
  g,
  busy,
  refreshing,
  onRefresh,
  onChange,
  onRemove,
  onSync,
}: {
  g: GitInfo;
  busy: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onChange: (name: string, url: string) => void;
  onRemove: (name: string) => void;
  onSync: (a: "fetch" | "pull" | "push") => void;
}) {
  const noRemote = !g.remotes.length;
  return (
    <Card
      title="Repository"
      icon={<GitBranch size={13} />}
      action={
        <button className="icon-btn" onClick={onRefresh} disabled={refreshing} aria-label="Refresh git status" title="Refresh git status">
          {refreshing ? <Spinner /> : <RefreshCw size={13} />}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono font-medium">{g.branch ?? "detached HEAD"}</span>
        {noRemote ? (
          <Pill tone="warn">No remote</Pill>
        ) : (
          <>
            {g.ahead > 0 && <Pill tone="accent">{g.ahead} ahead</Pill>}
            {g.behind > 0 && <Pill tone="warn">{g.behind} behind</Pill>}
            {!g.ahead && !g.behind && g.commits.length > 0 && <Pill tone="ok">In sync</Pill>}
          </>
        )}
        <span className="text-faint">{g.commits.length ? `${g.commits.length}${g.commits.length >= 15 ? "+" : ""} recent commits` : "no commits yet"}</span>
      </div>

      <h4 className="section-title mb-1.5">Remotes</h4>
      {noRemote ? (
        <p className="mb-3 text-[12px] text-muted">No remote yet: connect one below so agents can push and open pull requests.</p>
      ) : (
        <ul className="mb-3 divide-y divide-line rounded-[4px] border border-line" aria-label="Remotes">
          {g.remotes.map((r) => (
            <li key={r.name} className="flex min-h-8 min-w-0 items-center gap-2 px-2.5 py-1 text-[12px]">
              <span className="w-16 shrink-0 font-medium">{r.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={r.url}>
                {r.url}
              </span>
              {r.webUrl && (
                <a href={r.webUrl} target="_blank" rel="noreferrer" className="btn btn-sm" title={r.webUrl}>
                  <ExternalLink size={11} /> Open
                </a>
              )}
              <button className="icon-btn" disabled={!!busy} onClick={() => onChange(r.name, r.url)} aria-label={`Change ${r.name} URL`} title="Change URL">
                <Pencil size={12} />
              </button>
              <button className="icon-btn hover:!text-err" disabled={!!busy} onClick={() => onRemove(r.name)} aria-label={`Remove remote ${r.name}`} title="Remove remote">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" disabled={!!busy || noRemote} onClick={() => onSync("fetch")}>
          {busy === "Fetched" ? <Spinner /> : <CloudDownload size={12} />} Fetch
        </button>
        <button className="btn btn-sm" disabled={!!busy || noRemote} onClick={() => onSync("pull")}>
          {busy === "Pulled" ? <Spinner /> : <ArrowDownToLine size={12} />} Pull
        </button>
        <button className="btn btn-sm" disabled={!!busy || noRemote} onClick={() => onSync("push")}>
          {busy === "Pushed" ? <Spinner /> : <ArrowUpFromLine size={12} />} Push
        </button>
        {noRemote && <span className="text-[12px] text-faint">Connect a remote to sync.</span>}
      </div>
    </Card>
  );
}

const MODES: { id: Mode; label: string; icon: typeof Link2 }[] = [
  { id: "remote", label: "Remote URL", icon: Link2 },
  { id: "github", label: "New on GitHub", icon: GitPullRequestCreate },
  { id: "clone", label: "Clone", icon: CloudDownload },
  { id: "init", label: "Init git", icon: FolderGit2 },
];

function ConnectCard({
  project,
  g,
  gitLoaded,
  busy,
  run,
  focusKey,
}: {
  project: Project;
  g: GitInfo | null;
  gitLoaded: boolean;
  busy: string | null;
  run: (label: string, op: GitAction) => Promise<boolean>;
  focusKey?: number;
}) {
  const hasRepo = !!project.repo_path;
  const isGit = !!g;
  const available: Mode[] = !hasRepo ? ["clone"] : !isGit ? ["init", "clone"] : ["remote", "github", "clone"];
  const [mode, setMode] = useState<Mode>(available[0]);
  const ref = useRef<HTMLElement>(null);
  const hasOrigin = !!g?.remotes.some((r) => r.name === "origin");

  // Keep the selected mode valid as the repo state changes (e.g. after init / clone).
  const key = available.join(",");
  useEffect(() => {
    if (gitLoaded) setMode((m) => (key.split(",").includes(m) ? m : (key.split(",")[0] as Mode)));
  }, [key, gitLoaded]);

  useEffect(() => {
    if (!focusKey || !gitLoaded) return;
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    });
  }, [focusKey, gitLoaded]);

  return (
    <section ref={ref} id="hub-connect-repo" aria-labelledby="hub-connect-title" className="card scroll-mt-4 min-w-0">
      <header className="card-head">
        <Plug size={13} className="shrink-0 text-muted" aria-hidden />
        <h3 id="hub-connect-title" className="min-w-0 flex-1 truncate">
          {hasOrigin ? "Connect another repository" : "Connect repository"}
        </h3>
      </header>
      <div className="card-body">
      <p className="mb-3 text-[12px] text-muted">
        {!hasRepo ? "This project has no folder yet: clone a repository into a new folder and it becomes the project's repository." : !isGit ? "Turn the project folder into a git repository, or clone one instead." : "Link a remote so agents can push branches, open pull requests and read CI."}
      </p>

      <div className="mb-4 max-w-full overflow-x-auto [scrollbar-width:none]">
        <Segmented value={mode} onChange={setMode} label="How to connect" options={MODES.filter((m) => available.includes(m.id)).map((m) => ({ value: m.id, label: m.label, icon: m.icon }))} />
      </div>

      {mode === "remote" && <RemoteForm key={String(hasOrigin)} busy={busy} run={run} hasOrigin={hasOrigin} />}
      {mode === "github" && <GithubForm project={project} busy={busy} run={run} hasOrigin={hasOrigin} hasCommits={!!g?.commits.length} />}
      {mode === "clone" && <CloneForm project={project} busy={busy} run={run} />}
      {mode === "init" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 break-words text-[12px] text-muted">
            Runs <code className="font-mono">git init -b main</code> in <span className="font-mono text-fg">{project.repo_path}</span>.
          </p>
          <button data-autofocus className="btn btn-primary" disabled={!!busy} onClick={() => void run("Initialized git", { action: "init" })}>
            {busy === "Initialized git" ? <Spinner /> : <FolderGit2 size={12} />} Init git here
          </button>
        </div>
      )}
      </div>
    </section>
  );
}

function RemoteForm({ busy, run, hasOrigin }: { busy: string | null; run: (label: string, op: GitAction) => Promise<boolean>; hasOrigin: boolean }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState(hasOrigin ? "upstream" : "origin");
  const valid = REMOTE_RE.test(url.trim());
  const label = `Connected ${name.trim() || "origin"}`;
  return (
    <form
      className="grid grid-cols-1 gap-2 @2xl:grid-cols-[minmax(0,1fr)_140px_auto] @2xl:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        if (await run(label, { action: "set-remote", url: url.trim(), name: name.trim() || "origin" })) setUrl("");
      }}
    >
      <label className="block min-w-0">
        <span className="label">Remote URL</span>
        <input data-autofocus className="input font-mono" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/repo.git or git@github.com:you/repo.git" aria-invalid={!!url.trim() && !valid} />
      </label>
      <label className="block">
        <span className="label">Remote name</span>
        <input className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="origin" />
      </label>
      <button type="submit" className="btn btn-primary justify-self-start" disabled={!!busy || !valid}>
        {busy === label ? <Spinner /> : <Link2 size={12} />} {hasOrigin && name.trim() === "origin" ? "Change origin" : "Connect"}
      </button>
      {!!url.trim() && !valid && <p className="help !text-warn @2xl:col-span-3">Use an https://, git@ or ssh:// repository URL.</p>}
    </form>
  );
}

function GithubForm({ project, busy, run, hasOrigin, hasCommits }: { project: Project; busy: string | null; run: (label: string, op: GitAction) => Promise<boolean>; hasOrigin: boolean; hasCommits: boolean }) {
  const [name, setName] = useState(() => slugify(project.name));
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [description, setDescription] = useState(() => project.description.split("\n")[0].slice(0, 300));
  const label = "Created on GitHub";
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        const ok = await confirmDialog({
          title: `Create ${visibility} repository ${n} on GitHub?`,
          message: `Runs gh repo create with your GitHub CLI login and adds it as origin.${hasCommits ? " Existing commits are pushed." : " No commits yet: commit, then Push."}${visibility === "public" ? " Anyone will be able to see the code." : ""}`,
          confirmLabel: "Create repository",
          danger: visibility === "public",
        });
        if (ok) await run(label, { action: "create-github", name: n, visibility, description: description.trim() || undefined });
      }}
    >
      {hasOrigin && <p className="help !mt-0 !text-warn">This repository already has an origin remote. Remove it first: gh adds the new repository as origin.</p>}
      <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-[minmax(0,1fr)_160px]">
        <label className="block min-w-0">
          <span className="label">Repository name</span>
          <input data-autofocus className="input font-mono" required pattern="[A-Za-z0-9._\-]+" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Visibility</span>
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as "private" | "public")}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Description</span>
        <input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={!!busy || !name.trim() || hasOrigin}>
          {busy === label ? <Spinner /> : <GitPullRequestCreate size={12} />} Create on GitHub
        </button>
        <span className="text-[12px] text-faint">Needs the GitHub CLI signed in (gh auth login).</span>
      </div>
    </form>
  );
}

function CloneForm({ project, busy, run }: { project: Project; busy: string | null; run: (label: string, op: GitAction) => Promise<boolean> }) {
  const [url, setUrl] = useState("");
  const valid = REMOTE_RE.test(url.trim());
  const label = "Cloned";
  const submit = async () => {
    if (!valid) return;
    const parent = await pickFolder({ title: "Clone into…", message: "Pick the parent folder; the repository gets its own new folder inside it.", startIn: project.repo_path ? parentOf(project.repo_path) : null, confirmLabel: "Clone here" });
    if (!parent) return;
    const name = await promptDialog({ title: "New folder name", message: `Created inside ${parent}`, initial: repoNameFromUrl(url) || slugify(project.name), confirmLabel: "Clone" });
    if (!name?.trim()) return;
    const folder = `${parent.replace(/\/+$/, "")}/${name.trim().replace(/^\/+|\/+$/g, "")}`;
    if (project.repo_path && !(await confirmDialog({ title: "Switch this project to the clone?", message: `The project's repository folder changes from ${project.repo_path} to ${folder}. The old folder isn't touched.`, confirmLabel: "Clone and switch" }))) return;
    if (await run(label, { action: "clone", url: url.trim(), folder })) setUrl("");
  };
  return (
    <form
      className="grid grid-cols-1 gap-2 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="block min-w-0">
        <span className="label">Repository URL</span>
        <input data-autofocus className="input font-mono" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/repo.git" aria-invalid={!!url.trim() && !valid} />
      </label>
      <button type="submit" className="btn btn-primary justify-self-start" disabled={!!busy || !valid}>
        {busy === label ? <Spinner /> : <FolderOpen size={12} />} Choose folder and clone…
      </button>
      <p className="help !mt-0 @2xl:col-span-2">
        {!!url.trim() && !valid ? <span className="text-warn">Use an https://, git@ or ssh:// repository URL. </span> : null}
        Clones into a new, empty folder; it becomes this project&apos;s repository folder.
      </p>
    </form>
  );
}

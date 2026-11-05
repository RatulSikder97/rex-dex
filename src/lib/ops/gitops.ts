import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getProject, updateProject } from "../repo";
import { errorOf, findBin, run } from "./exec";

/**
 * Project ⇄ Git hosting, from the Project hub: connect or change the remote,
 * clone a repo into a folder, create the GitHub repo with your gh login,
 * and fetch / pull / push. Uses your local git + gh credentials (no tokens in REX).
 */

const REMOTE_RE = /^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|git@[\w.-]+:[\w./~-]+|ssh:\/\/[\w.@-]+(:\d+)?\/[\w./~-]+)$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type GitOp =
  | { action: "init" }
  | { action: "set-remote"; url: string; name?: string }
  | { action: "remove-remote"; name: string }
  | { action: "clone"; url: string; folder: string }
  | { action: "create-github"; name: string; visibility: "private" | "public"; description?: string }
  | { action: "fetch" | "pull" | "push" };

export async function gitOp(projectId: string, op: GitOp): Promise<{ ok: true; output: string; repoPath?: string }> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  const git = findBin(["git"]) ?? "git";

  if (op.action === "clone") {
    if (!REMOTE_RE.test(op.url)) throw new Error("Use an https:// or git@ repository URL");
    const dest = path.resolve(op.folder);
    if (!path.isAbsolute(op.folder)) throw new Error("Folder must be an absolute path");
    if (fs.existsSync(/*turbopackIgnore: true*/ dest) && fs.readdirSync(/*turbopackIgnore: true*/ dest).length) throw new Error("Target folder exists and isn't empty");
    if (!fs.existsSync(/*turbopackIgnore: true*/ path.dirname(dest))) throw new Error("Parent folder doesn't exist");
    const r = await run(git, ["clone", "--", op.url, dest], { timeout: 300_000 });
    if (!r.ok) throw new Error(errorOf(r, "git clone failed"));
    updateProject(projectId, { repo_path: dest });
    return { ok: true, output: r.stderr || "Cloned", repoPath: dest };
  }

  const root = project.repo_path;
  if (!root || !fs.existsSync(/*turbopackIgnore: true*/ root)) throw new Error("Link a repository folder first (General → Repository folder)");
  const g = (args: string[], timeout = 60_000) => run(git, args, { cwd: root, timeout });

  switch (op.action) {
    case "init": {
      const r = await g(["init", "-b", "main"]);
      if (!r.ok) throw new Error(errorOf(r, "git init failed"));
      return { ok: true, output: r.stdout.trim() };
    }
    case "set-remote": {
      if (!REMOTE_RE.test(op.url)) throw new Error("Use an https:// or git@ repository URL");
      const name = op.name || "origin";
      if (!NAME_RE.test(name)) throw new Error("Invalid remote name");
      const has = (await g(["remote"])).stdout.split("\n").includes(name);
      const r = await g(has ? ["remote", "set-url", name, op.url] : ["remote", "add", name, op.url]);
      if (!r.ok) throw new Error(errorOf(r, "git remote failed"));
      return { ok: true, output: `${name} → ${op.url}` };
    }
    case "remove-remote": {
      if (!NAME_RE.test(op.name)) throw new Error("Invalid remote name");
      const r = await g(["remote", "remove", op.name]);
      if (!r.ok) throw new Error(errorOf(r, "git remote remove failed"));
      return { ok: true, output: `Removed ${op.name}` };
    }
    case "create-github": {
      const gh = findBin(["gh"]);
      if (!gh) throw new Error("GitHub CLI not installed (brew install gh, then gh auth login)");
      if (!NAME_RE.test(op.name)) throw new Error("Repository name: letters, digits, . _ -");
      const hasCommits = (await g(["rev-parse", "--verify", "HEAD"])).ok;
      const args = ["repo", "create", op.name, `--${op.visibility}`, "--source", root, "--remote", "origin"];
      if (op.description) args.push("--description", op.description.slice(0, 300));
      if (hasCommits) args.push("--push");
      const r = await run(gh, args, { cwd: root, timeout: 120_000 });
      if (!r.ok) throw new Error(errorOf(r, "gh repo create failed (run gh auth login)"));
      return { ok: true, output: (r.stdout || r.stderr).trim() + (hasCommits ? "" : "\nNo commits yet: commit, then Push.") };
    }
    case "fetch":
    case "pull":
    case "push": {
      const args = op.action === "push" ? ["push", "-u", "origin", "HEAD"] : op.action === "pull" ? ["pull", "--ff-only"] : ["fetch", "--all", "--prune"];
      const r = await g(args, 180_000);
      if (!r.ok) throw new Error(errorOf(r, `git ${op.action} failed`));
      return { ok: true, output: (r.stdout + "\n" + r.stderr).trim() || `${op.action} ok` };
    }
  }
}

import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { resolveInside } from "./fsx";

const MAX_SHOW_BYTES = 8 * 1024 * 1024;

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs git with an argument array in `cwd`. Never throws on a non-zero exit; inspect `code`. */
export function git(cwd: string, args: string[], opts: { input?: string; maxBuffer?: number } = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      },
      (err, stdout, stderr) => {
        if (err && typeof (err as NodeJS.ErrnoException).code === "string") return reject(err);
        const code = err ? ((err as { code?: number }).code ?? 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
}

/** Validates `rel` is inside the repo and returns it as a posix path relative to the root. */
function safeRel(root: string, rel: string): string {
  resolveInside(root, rel);
  const clean = rel.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (!clean || clean.split("/").includes("..")) throw new Error("Invalid path");
  return clean;
}

export async function isRepo(root: string): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

async function hasHead(root: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
}

export type StatusLetter = "M" | "A" | "D" | "R" | "C" | "U" | "T" | "?";

export interface ChangeEntry {
  path: string;
  /** Original path for renames/copies. */
  from?: string;
  status: StatusLetter;
}

export interface GitStatus {
  repo: boolean;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasHead: boolean;
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  conflicts: ChangeEntry[];
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export async function status(root: string): Promise<GitStatus> {
  if (!(await isRepo(root))) {
    return { repo: false, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, hasHead: false, staged: [], unstaged: [], conflicts: [] };
  }
  // -b gives the branch header (incl. ahead/behind) in one call.
  const out = await gitOk(root, ["status", "--porcelain=v1", "-z", "-b", "-uall"]);
  const parts = out.split("\0");
  // Porcelain paths are repo-root relative; the project may live in a subfolder of the repo.
  const prefix = (await gitOk(root, ["rev-parse", "--show-prefix"])).trim();
  const local = (p: string | undefined) => (p === undefined ? undefined : prefix ? (p.startsWith(prefix) ? p.slice(prefix.length) : null) : p);
  let branch: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const staged: ChangeEntry[] = [];
  const unstaged: ChangeEntry[] = [];
  const conflicts: ChangeEntry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith("## ")) {
      const h = rec.slice(3);
      if (h.startsWith("No commits yet on ")) branch = h.slice("No commits yet on ".length).split("...")[0];
      else if (h.startsWith("HEAD (no branch)")) detached = true;
      else {
        const m = h.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
        if (m) {
          branch = m[1];
          upstream = m[2] ?? null;
          const a = m[3]?.match(/ahead (\d+)/);
          const b = m[3]?.match(/behind (\d+)/);
          ahead = a ? Number(a[1]) : 0;
          behind = b ? Number(b[1]) : 0;
        }
      }
      continue;
    }
    const x = rec[0];
    const y = rec[1];
    const p = local(rec.slice(3));
    let from: string | undefined;
    if (x === "R" || x === "C") from = local(parts[++i]) ?? undefined;
    if (!p) continue;
    if (x === "?" && y === "?") {
      unstaged.push({ path: p, status: "?" });
      continue;
    }
    if (x === "!" && y === "!") continue;
    if (CONFLICT.has(x + y)) {
      conflicts.push({ path: p, status: "U" });
      continue;
    }
    if (x !== " ") staged.push({ path: p, from, status: x as StatusLetter });
    if (y !== " ") unstaged.push({ path: p, status: y as StatusLetter });
  }
  if (detached) branch = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim() || null;
  return { repo: true, branch, detached, upstream, ahead, behind, hasHead: await hasHead(root), staged, unstaged, conflicts };
}

async function showBlob(root: string, spec: string): Promise<string | null> {
  const r = await git(root, ["show", spec], { maxBuffer: MAX_SHOW_BYTES });
  return r.code === 0 ? r.stdout : null;
}

/** The three versions of a file needed for a diff view. Missing versions are null. */
export async function fileVersions(
  root: string,
  rel: string,
  /** For renames: the original path, whose HEAD version is the diff base. */
  fromRel?: string,
): Promise<{ head: string | null; index: string | null; working: string | null; binary: boolean }> {
  const p = safeRel(root, rel);
  const headPath = fromRel ? safeRel(root, fromRel) : p;
  const head = (await hasHead(root)) ? await showBlob(root, `HEAD:./${headPath}`) : null;
  const index = await showBlob(root, `:./${p}`);
  let working: string | null = null;
  const abs = resolveInside(root, p);
  if (fs.existsSync(/*turbopackIgnore: true*/ abs) && fs.statSync(/*turbopackIgnore: true*/ abs).isFile()) {
    const st = fs.statSync(/*turbopackIgnore: true*/ abs);
    working = st.size > MAX_SHOW_BYTES ? null : fs.readFileSync(/*turbopackIgnore: true*/ abs, "utf8");
  }
  const binary = [head, index, working].some((s) => s !== null && s.slice(0, 8000).includes("\0"));
  return binary ? { head: null, index: null, working: null, binary } : { head, index, working, binary };
}

export async function stage(root: string, paths: string[]) {
  const rels = paths.map((p) => safeRel(root, p));
  // -A also records deletions of tracked files.
  await gitOk(root, ["add", "-A", "--", ...rels]);
}

export async function unstage(root: string, paths: string[]) {
  const rels = paths.map((p) => safeRel(root, p));
  if (await hasHead(root)) await gitOk(root, ["restore", "--staged", "--", ...rels]);
  else await gitOk(root, ["rm", "--cached", "-r", "-q", "--", ...rels]);
}

/**
 * Discards working-tree changes. Untracked files are deleted (callers must confirm first).
 * Index state is kept, matching VS Code's "Discard Changes" on the Changes group.
 */
export async function discard(root: string, paths: string[]) {
  const rels = paths.map((p) => safeRel(root, p));
  const untracked = new Set<string>();
  const out = await gitOk(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...rels]);
  for (const f of out.split("\0")) if (f) untracked.add(f);
  for (const f of untracked) fs.rmSync(/*turbopackIgnore: true*/ resolveInside(root, f), { force: true });
  const tracked = rels.filter((r) => !untracked.has(r));
  if (!tracked.length) return;
  const known = await gitOk(root, ["ls-files", "-z", "--", ...tracked]);
  const inIndex = known.split("\0").filter(Boolean);
  if (inIndex.length) await gitOk(root, ["restore", "--worktree", "--", ...inIndex]);
}

export async function commit(root: string, message: string): Promise<string> {
  if (!message.trim()) throw new Error("Commit message is empty");
  const r = await git(root, ["commit", "-F", "-"], { input: message });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "git commit failed");
  return (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
}

export async function init(root: string) {
  if (await isRepo(root)) throw new Error("Already a git repository");
  await gitOk(root, ["init"]);
}

export interface LogEntry {
  hash: string;
  short: string;
  author: string;
  date: number;
  subject: string;
}

export async function log(root: string, limit = 20): Promise<LogEntry[]> {
  if (!(await hasHead(root))) return [];
  const out = await gitOk(root, ["log", `-n${Math.min(Math.max(limit, 1), 200)}`, "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e"]);
  return out
    .split("\x1e")
    .map((l) => l.replace(/^\n/, ""))
    .filter(Boolean)
    .map((l) => {
      const [hash, short, author, at, subject] = l.split("\x1f");
      return { hash, short, author, date: Number(at) * 1000, subject };
    });
}

export async function stagedDiff(root: string, maxChars = 60_000): Promise<string> {
  const stat = await gitOk(root, ["diff", "--staged", "--stat"]);
  const diff = await gitOk(root, ["diff", "--staged", "--no-color", "--no-ext-diff"]);
  const full = `${stat}\n${diff}`;
  return full.length > maxChars ? `${full.slice(0, maxChars)}\n…(diff truncated)` : full;
}

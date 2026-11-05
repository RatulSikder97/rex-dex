import "server-only";
import fs from "node:fs";
import path from "node:path";
import { fail } from "./http";
import { getProject } from "./repo";

const IGNORED = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo", ".cache", "coverage", "target", ".venv", "__pycache__", ".idea", ".DS_Store"]);
const MAX_READ_BYTES = 2 * 1024 * 1024;

export interface FsEntry {
  name: string;
  path: string; // relative to root, posix separators
  dir: boolean;
}

/** Resolves `rel` inside `root`, refusing anything that escapes it (incl. via symlinks). */
export function resolveInside(root: string, rel: string): string {
  const realRoot = fs.realpathSync(/*turbopackIgnore: true*/ root);
  const target = path.resolve(realRoot, rel || ".");
  const real = fs.existsSync(/*turbopackIgnore: true*/ target) ? fs.realpathSync(/*turbopackIgnore: true*/ target) : target;
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error("Path escapes project root");
  return real;
}

export function listDir(root: string, rel: string): FsEntry[] {
  const abs = resolveInside(root, rel);
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => !IGNORED.has(d.name))
    .map((d) => ({ name: d.name, path: path.posix.join(rel.split(path.sep).join("/") || "", d.name).replace(/^\//, ""), dir: d.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

export function readFile(root: string, rel: string): { content: string; binary: boolean; size: number } {
  const abs = resolveInside(root, rel);
  const st = fs.statSync(/*turbopackIgnore: true*/ abs);
  if (st.size > MAX_READ_BYTES) return { content: "", binary: true, size: st.size };
  const buf = fs.readFileSync(/*turbopackIgnore: true*/ abs);
  const binary = buf.subarray(0, 8000).includes(0);
  return { content: binary ? "" : buf.toString("utf8"), binary, size: st.size };
}

export function writeFile(root: string, rel: string, content: string) {
  const abs = resolveInside(root, rel);
  if (fs.existsSync(/*turbopackIgnore: true*/ abs) && fs.statSync(/*turbopackIgnore: true*/ abs).isDirectory()) throw new Error("Cannot write to a directory");
  fs.writeFileSync(/*turbopackIgnore: true*/ abs, content, "utf8");
}

// ---------------------------------------------------------------- quick open / file ops

const RG_CANDIDATES = ["/opt/homebrew/bin/rg", "/usr/local/bin/rg", "/usr/bin/rg"];
const MAX_LIST_FILES = 20_000;

/** Absolute path of ripgrep, or null when it's not installed. */
export function rgPath(): string | null {
  for (const p of RG_CANDIDATES) if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p;
  return null;
}

function walkFiles(root: string, max: number): string[] {
  const out: string[] = [];
  const stack = [""];
  while (stack.length && out.length < max) {
    const rel = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(/*turbopackIgnore: true*/ path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of ents) {
      if (IGNORED.has(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) stack.push(r);
      else if (d.isFile()) {
        out.push(r);
        if (out.length >= max) break;
      }
    }
  }
  return out.sort();
}

/** Every file path (relative, posix) in the repo; respects .gitignore when ripgrep is available. */
export async function listAllFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const abs = resolveInside(root, "");
  const rg = rgPath();
  if (rg) {
    const { execFile } = await import("node:child_process");
    const files = await new Promise<string[] | null>((resolve) => {
      execFile(/*turbopackIgnore: true*/ rg, ["--files", "--hidden", "--glob", "!.git"], { cwd: abs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        // rg exits 1 when no files match; still a valid (empty) answer.
        if (err && (err as { code?: unknown }).code !== 1) return resolve(null);
        resolve(stdout.split("\n").filter(Boolean));
      });
    });
    if (files) {
      files.sort();
      return { files: files.slice(0, MAX_LIST_FILES), truncated: files.length > MAX_LIST_FILES };
    }
  }
  const files = walkFiles(abs, MAX_LIST_FILES + 1);
  return { files: files.slice(0, MAX_LIST_FILES), truncated: files.length > MAX_LIST_FILES };
}

export type FileOp = "create" | "mkdir" | "rename" | "delete";

/**
 * Resolves the entry `rel` itself (not following a final symlink) with its parent sandboxed inside `root`.
 * Refuses the root itself and "."/".." leaf names.
 */
function entryInside(root: string, rel: string): string {
  const clean = rel.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = path.posix.basename(clean);
  if (!clean || !base || base === "." || base === "..") throw new Error("Refusing to operate on the project root");
  const parent = resolveInside(root, path.posix.dirname(clean));
  return path.join(parent, base);
}

/** Create / mkdir / rename / delete inside `root`. Never touches the root itself. */
export function fileOp(root: string, op: FileOp, rel: string, to?: string) {
  const abs = entryInside(root, rel);
  const exists = (p: string) => {
    try {
      fs.lstatSync(/*turbopackIgnore: true*/ p);
      return true;
    } catch {
      return false;
    }
  };
  switch (op) {
    case "create": {
      if (exists(abs)) throw new Error("A file or folder with that name already exists");
      fs.writeFileSync(/*turbopackIgnore: true*/ abs, "", { flag: "wx" });
      return;
    }
    case "mkdir": {
      if (exists(abs)) throw new Error("A file or folder with that name already exists");
      fs.mkdirSync(/*turbopackIgnore: true*/ abs);
      return;
    }
    case "rename": {
      if (!to) throw new Error("Missing destination");
      if (!exists(abs)) throw new Error("Source does not exist");
      const dest = entryInside(root, to);
      if (exists(dest)) throw new Error("Destination already exists");
      if (dest.startsWith(abs + path.sep)) throw new Error("Cannot move a folder into itself");
      fs.renameSync(/*turbopackIgnore: true*/ abs, dest);
      return;
    }
    case "delete": {
      if (!exists(abs)) throw new Error("Path does not exist");
      fs.rmSync(/*turbopackIgnore: true*/ abs, { recursive: true });
      return;
    }
  }
}

/** The project's repo folder, or a 4xx Response explaining why there isn't a usable one. */
export function projectRoot(projectId: string | null | undefined): string | Response {
  if (!projectId) return fail("Missing projectId", 400);
  const p = getProject(projectId);
  if (!p) return fail("Project not found", 404);
  if (!p.repo_path) return fail("Project has no repo path. Set one in project settings.", 400);
  if (!fs.existsSync(/*turbopackIgnore: true*/ p.repo_path)) return fail(`Repo folder does not exist: ${p.repo_path}`, 400);
  return p.repo_path;
}

import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBin, run } from "./ops/exec";

/**
 * Local-machine helpers. REX's server runs on the user's own computer, so it
 * can show the OS's native folder picker (Finder on macOS) and browse folders
 * for the in-app explorer.
 */

/** Native "choose folder" dialog. Resolves to an absolute path, or null when cancelled / unavailable. */
export async function pickFolderNative(prompt: string, startIn?: string): Promise<{ path: string | null; supported: boolean }> {
  const title = prompt.replace(/["\\]/g, "").slice(0, 120) || "Choose a folder";
  const start = startIn && fs.existsSync(/*turbopackIgnore: true*/ startIn) ? startIn : os.homedir();
  if (process.platform === "darwin") {
    // `activate` brings osascript's own dialog to the front; no Automation permission needed.
    const script = `activate\nset f to choose folder with prompt "${title}" default location (POSIX file "${start.replace(/["\\]/g, "")}")\nPOSIX path of f`;
    const r = await run("/usr/bin/osascript", ["-e", script], { timeout: 10 * 60_000 });
    if (!r.ok) return { path: null, supported: true }; // user cancelled (-128)
    return { path: r.stdout.trim().replace(/\/$/, "") || null, supported: true };
  }
  if (process.platform === "linux") {
    const zenity = findBin(["zenity"]);
    const kdialog = findBin(["kdialog"]);
    if (zenity) {
      const r = await run(zenity, ["--file-selection", "--directory", `--title=${title}`, `--filename=${start}/`], { timeout: 10 * 60_000 });
      return { path: r.ok ? r.stdout.trim() || null : null, supported: true };
    }
    if (kdialog) {
      const r = await run(kdialog, ["--getexistingdirectory", start, "--title", title], { timeout: 10 * 60_000 });
      return { path: r.ok ? r.stdout.trim() || null : null, supported: true };
    }
    return { path: null, supported: false };
  }
  if (process.platform === "win32") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${title.replace(/'/g, "")}'; $d.SelectedPath = '${start.replace(/'/g, "")}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`;
    const r = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { timeout: 10 * 60_000 });
    return { path: r.ok ? r.stdout.trim() || null : null, supported: true };
  }
  return { path: null, supported: false };
}

export interface DirEntry {
  name: string;
  path: string;
  git: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  entries: DirEntry[];
  /** Quick places that exist on this machine. */
  places: { label: string; path: string }[];
  git: boolean;
}

const PLACES = ["Desktop", "Documents", "Downloads", "PROJECTS", "Projects", "projects", "code", "Code", "dev", "Developer", "src", "work", "EASITAL"];

export function listDirs(p?: string | null): DirListing {
  const home = os.homedir();
  const dir = path.resolve(p && path.isAbsolute(p) ? p : home);
  const st = fs.statSync(/*turbopackIgnore: true*/ dir);
  if (!st.isDirectory()) throw new Error("Not a folder");
  const entries: DirEntry[] = [];
  for (const d of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) {
    if (d.name.startsWith(".") || d.name === "node_modules") continue;
    const full = path.join(/*turbopackIgnore: true*/ dir, d.name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = fs.statSync(/*turbopackIgnore: true*/ full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    entries.push({ name: d.name, path: full, git: fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ full, ".git")) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const places = [{ label: "Home", path: home }, ...PLACES.map((n) => ({ label: n, path: path.join(/*turbopackIgnore: true*/ home, n) })).filter((x) => fs.existsSync(/*turbopackIgnore: true*/ x.path))];
  return {
    path: dir,
    parent: path.dirname(dir) === dir ? null : path.dirname(dir),
    home,
    entries: entries.slice(0, 500),
    places: places.filter((pl, i, a) => a.findIndex((x) => x.path.toLowerCase() === pl.path.toLowerCase()) === i),
    git: fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, ".git")),
  };
}

export function createDir(parent: string, name: string): string {
  if (!/^[^/\\:*?"<>|]{1,120}$/.test(name) || name === "." || name === "..") throw new Error("Invalid folder name");
  const full = path.join(/*turbopackIgnore: true*/ path.resolve(parent), name);
  fs.mkdirSync(/*turbopackIgnore: true*/ full);
  return full;
}

// Stages the REX engine for the desktop app: desktop/stage/server = Next.js
// standalone output + static assets + runtime folders (marketplace/, bin/) +
// complete native modules, then smoke-tests them under Electron's Node ABI.
//
// Usage: node desktop/scripts/stage.mjs [--skip-next-build]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stage = path.join(root, "desktop", "stage", "server");
const skipBuild = process.argv.includes("--skip-next-build");
const step = (msg) => console.log(`\n[desktop] ${msg}`);

// ---------------------------------------------------------------- 1. next build
if (!skipBuild) {
  step("next build (output: standalone)");
  const r = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// ---------------------------------------------------------------- 2. standalone → stage
const standalone = path.join(root, ".next", "standalone");
/** Next nests the app under its path relative to the tracing root (monorepos / parent lockfiles). */
function findServerDir(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, "server.js")) && fs.existsSync(path.join(dir, ".next"))) return dir;
  if (depth > 6) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    const hit = findServerDir(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}
if (!fs.existsSync(standalone)) throw new Error(`${standalone} missing — is output: "standalone" set in next.config.ts?`);
const serverDir = findServerDir(standalone);
if (!serverDir) throw new Error("server.js not found in .next/standalone");
if (serverDir !== standalone) throw new Error(`standalone server is nested at ${path.relative(standalone, serverDir)}; set outputFileTracingRoot to the project root`);

step(`staging → ${path.relative(root, stage)}`);
fs.rmSync(path.dirname(stage), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
// verbatimSymlinks: keep Turbopack's relative .next/node_modules/<pkg>-<hash> links relative (valid inside the app bundle).
fs.cpSync(standalone, stage, { recursive: true, verbatimSymlinks: true });

const copyDir = (from, to) => fs.existsSync(from) && fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
copyDir(path.join(root, ".next", "static"), path.join(stage, ".next", "static"));
copyDir(path.join(root, "public"), path.join(stage, "public"));
// Read at runtime relative to process.cwd(): plugin catalog and the `rex` CLI / MCP helpers.
copyDir(path.join(root, "marketplace"), path.join(stage, "marketplace"));
copyDir(path.join(root, "bin"), path.join(stage, "bin"));

// Never ship the developer's data, secrets or tooling folders if tracing picked them up.
for (const junk of ["data", ".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".playwright-mcp", ".claude", ".git", "desktop", "dist", "src"]) {
  fs.rmSync(path.join(stage, junk), { recursive: true, force: true });
}

// ---------------------------------------------------------------- 3. native modules
// Copy complete packages (tracing can miss files loaded via computed paths), then
// prune build sources and other platforms' binaries.
const nm = path.join(stage, "node_modules");
const platformKey = process.platform;
const nativePkgs = ["better-sqlite3", "node-pty", "@resvg/resvg-js"];
for (const d of fs.readdirSync(path.join(root, "node_modules", "@resvg"))) if (d.startsWith("resvg-js-")) nativePkgs.push(`@resvg/${d}`);
for (const p of nativePkgs) {
  const dest = path.join(nm, p);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(root, "node_modules", p), dest, { recursive: true, verbatimSymlinks: true });
}

// macOS ships arm64 + x64 builds from one staged engine: make sure resvg's binary for both arches is present.
if (process.platform === "darwin") {
  const ver = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@resvg/resvg-js/package.json"), "utf8")).version;
  for (const arch of ["arm64", "x64"]) {
    const name = `@resvg/resvg-js-darwin-${arch}`;
    if (fs.existsSync(path.join(nm, name))) continue;
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rex-resvg-"));
      const tgz = execFileSync("npm", ["pack", `${name}@${ver}`, "--silent"], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
      execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", tmp]);
      fs.cpSync(path.join(tmp, "package"), path.join(nm, name), { recursive: true });
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`  + ${name}@${ver}`);
    } catch (e) {
      console.warn(`  ! could not fetch ${name}@${ver} (${e.message.split("\n")[0]}); the ${arch} build will lack SVG rasterizing`);
    }
  }
}

const rm = (...p) => fs.rmSync(path.join(nm, ...p), { recursive: true, force: true });
rm("better-sqlite3", "deps");
rm("better-sqlite3", "src");
for (const f of fs.readdirSync(path.join(nm, "better-sqlite3", "prebuilds"))) if (!f.startsWith(`${platformKey}-`)) rm("better-sqlite3", "prebuilds", f);
for (const d of ["src", "deps", "third_party", "scripts", "typings"]) rm("node-pty", d);
for (const d of fs.readdirSync(path.join(nm, "node-pty", "prebuilds"))) if (!d.startsWith(`${platformKey}-`)) rm("node-pty", "prebuilds", d);
// node-pty's prebuilt spawn-helper ships without the executable bit ("posix_spawnp failed").
for (const d of fs.readdirSync(path.join(nm, "node-pty", "prebuilds"))) {
  const helper = path.join(nm, "node-pty", "prebuilds", d, "spawn-helper");
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
for (const f of fs.readdirSync(path.join(stage, "bin"))) fs.chmodSync(path.join(stage, "bin", f), 0o755);

// Every symlink must stay inside the staged engine (codesign rejects others; they'd dangle on customers' machines).
(function checkLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      const resolved = path.resolve(path.dirname(p), target);
      if (path.isAbsolute(target) || !resolved.startsWith(stage + path.sep) || !fs.existsSync(resolved)) throw new Error(`bad symlink in stage: ${path.relative(stage, p)} -> ${target}`);
    } else if (e.isDirectory()) checkLinks(p);
  }
})(stage);

// ---------------------------------------------------------------- 4. desktop entry
fs.writeFileSync(
  path.join(stage, "rex-desktop-server.js"),
  `"use strict";
// Desktop entry: Electron runs this with ELECTRON_RUN_AS_NODE=1 (see desktop/app/lib/server.js).
// Child processes (agent CLIs, terminals) must not inherit that flag — an Electron-based
// tool launched from REX would otherwise start as plain Node. Node's own fork() keeps it.
const cp = require("node:child_process");
delete process.env.ELECTRON_RUN_AS_NODE;
const fork = cp.fork;
cp.fork = function (modulePath, args, options) {
  if (!Array.isArray(args)) (options = args), (args = []);
  const o = { ...(options || {}) };
  if (!o.execPath || o.execPath === process.execPath) o.env = { ...(o.env || process.env), ELECTRON_RUN_AS_NODE: "1" };
  return fork.call(this, modulePath, args, o);
};
require("./server.js");
`,
);

// ---------------------------------------------------------------- 5. ABI smoke test
step("checking native modules under Electron's Node");
const electronBin = require("electron");
const probe = `
const D = require("better-sqlite3"); new D(":memory:").prepare("select 1").get();
const pty = require("node-pty"); const p = pty.spawn("${process.platform === "win32" ? "cmd.exe" : "/bin/sh"}", ${process.platform === "win32" ? '["/c","echo ok"]' : '["-c","echo ok"]'}, {});
require("@resvg/resvg-js");
let out = ""; p.onData((d) => (out += d)); p.onExit(() => { console.log("electron", process.versions.electron, "node", process.versions.node, "pty:", out.trim()); process.exit(out.includes("ok") ? 0 : 1); });
`;
const smoke = spawnSync(electronBin, ["-e", probe], { cwd: stage, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60000 });
process.stdout.write(smoke.stdout || "");
if (smoke.status !== 0) {
  console.error(smoke.stderr);
  throw new Error("native modules failed to load under Electron — rebuild them for Electron's ABI (npx @electron/rebuild -m desktop/stage/server)");
}

// ---------------------------------------------------------------- 6. version
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const appPkgFile = path.join(root, "desktop", "app", "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgFile, "utf8"));
if (appPkg.version !== rootPkg.version) {
  appPkg.version = rootPkg.version;
  fs.writeFileSync(appPkgFile, JSON.stringify(appPkg, null, 2) + "\n");
}

let size = "";
try {
  size = ` (${execFileSync("du", ["-sh", stage], { encoding: "utf8" }).split("\t")[0]})`;
} catch {
  /* du unavailable (Windows) */
}
step(`engine staged${size}`);

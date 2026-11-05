// `npm run desktop:build`: stage the engine, then package with electron-builder for
// the host OS. Arch: the host's by default; REX_DESKTOP_ARCH=all builds arm64 + x64.
// Extra args are passed to electron-builder (e.g. `-- --dir` for an unpacked app).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (cmd, args, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const passthrough = process.argv.slice(2);
run(process.execPath, [path.join(root, "desktop", "scripts", "stage.mjs"), ...passthrough.filter((a) => a === "--skip-next-build")]);

const ALL = { darwin: ["--arm64", "--x64"], win32: ["--x64", "--arm64"], linux: ["--x64", "--arm64"] };
const archArg = (process.env.REX_DESKTOP_ARCH || "host") === "all" ? (ALL[process.platform] ?? []) : [`--${process.arch}`];
const env = { ...process.env };
// No signing identity configured → build unsigned (ad-hoc on macOS, see after-sign.cjs)
// instead of failing on keychain lookups.
if (!env.CSC_LINK && !env.CSC_NAME && !env.WIN_CSC_LINK) env.CSC_IDENTITY_AUTO_DISCOVERY ??= "false";
const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
run(bin, ["--config", "desktop/electron-builder.yml", "--publish", "never", ...archArg, ...passthrough.filter((a) => a !== "--skip-next-build")], env);

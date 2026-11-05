// @ts-check
"use strict";
/**
 * GUI apps on macOS/Linux start with launchd's minimal environment (PATH =
 * /usr/bin:/bin:...), so the CLIs REX drives (claude, codex, gh, git, ffmpeg, brew,
 * node) would not be found. Resolve the user's login-shell environment once, the
 * same way VS Code does: run `$SHELL -ilc 'env -0'` and parse the output.
 */
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const START = "__REX_ENV_START__";
const END = "__REX_ENV_END__";
/** Variables that describe the probe shell itself, not the user's setup. */
const SKIP = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"]);

/** Common install locations, appended in case the shell profile is broken. */
function fallbackDirs() {
  const home = os.homedir();
  return ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", path.join(home, ".local/bin"), path.join(home, ".npm-global/bin"), path.join(home, ".bun/bin"), path.join(home, ".cargo/bin")];
}

/** @param {string} raw */
function parse(raw) {
  const s = raw.indexOf(START);
  const e = raw.indexOf(END, s);
  if (s < 0 || e < 0) return null;
  /** @type {Record<string, string>} */
  const env = {};
  for (const entry of raw.slice(s + START.length, e).split("\0")) {
    const line = entry.replace(/^\n/, "");
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i);
    if (!SKIP.has(key)) env[key] = line.slice(i + 1);
  }
  return env;
}

/**
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, string>>} the login-shell env (empty on Windows or failure)
 */
function resolveShellEnv(timeoutMs = 6000) {
  if (process.platform === "win32") return Promise.resolve({});
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const script = `printf '${START}'; /usr/bin/env -0; printf '${END}'`;
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", script],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, REX_SHELL_ENV_PROBE: "1" }, encoding: "utf8" },
      (_err, stdout) => resolve(parse(stdout || "") ?? {}),
    );
  });
}

/**
 * Merge the login-shell env over the process env and make sure PATH contains the
 * usual install locations.
 * @param {Record<string, string>} shellEnv
 */
function mergedEnv(shellEnv) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, ...shellEnv };
  delete env.REX_SHELL_ENV_PROBE;
  if (process.platform !== "win32") {
    const parts = (env.PATH || "").split(":").filter(Boolean);
    for (const d of fallbackDirs()) if (!parts.includes(d)) parts.push(d);
    env.PATH = parts.join(":");
  }
  return env;
}

module.exports = { resolveShellEnv, mergedEnv };

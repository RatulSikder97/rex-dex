// @ts-check
"use strict";
/**
 * Runs the bundled REX engine (Next.js standalone server) as a child process with
 * Electron's own Node runtime (ELECTRON_RUN_AS_NODE), so customers don't need Node.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";

/** @param {number} port */
function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, HOST, () => srv.close(() => resolve(true)));
  });
}

/** @returns {Promise<number>} */
function randomFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * The previously used port when it's still free (keeps the page origin — and so
 * localStorage — stable across launches); otherwise a new free port.
 * @param {number | undefined} preferred
 */
async function pickPort(preferred) {
  if (preferred && (await isFree(preferred))) return preferred;
  for (let i = 0; i < 20; i++) {
    const p = 47000 + Math.floor(Math.random() * 2000);
    if (await isFree(p)) return p;
  }
  return randomFreePort();
}

/**
 * Resolves once GET `url` answers with a non-5xx status.
 * @param {string} url
 * @param {{ timeoutMs?: number; isAlive?: () => boolean }} [opts]
 */
async function waitForHttp(url, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 60000);
  while (Date.now() < deadline) {
    if (opts.isAlive && !opts.isAlive()) throw new Error("The REX engine exited during startup.");
    const status = await new Promise((resolve) => {
      const req = http.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", () => resolve(0));
      req.on("timeout", () => (req.destroy(), resolve(0)));
    });
    if (typeof status === "number" && status > 0 && status < 500) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`The REX engine did not respond at ${url}.`);
}

/**
 * @param {{ serverDir: string; port: number; dataDir: string; secret: string; env: Record<string, string | undefined>; logFile: string }} o
 */
function startServer(o) {
  const entry = path.join(o.serverDir, "rex-desktop-server.js");
  if (!fs.existsSync(entry)) throw new Error(`REX engine not found at ${entry}`);
  fs.mkdirSync(o.dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
  const log = fs.createWriteStream(o.logFile, { flags: "w" });

  /** @type {Record<string, string | undefined>} */
  const env = {
    ...o.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(o.port),
    // The login shell often exports HOSTNAME (the machine name); the server must bind loopback only.
    HOSTNAME: HOST,
    REX_DATA_DIR: o.dataDir,
    REX_SESSION_SECRET: o.secret,
    REX_DESKTOP: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // A user's NODE_OPTIONS (--require hooks, inspectors…) must not leak into the bundled runtime.
  delete env.NODE_OPTIONS;

  const child = spawn(process.execPath, [entry], {
    cwd: o.serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so quitting can stop the server and the agent CLIs it spawned.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  /** @type {string[]} */
  const tail = [];
  const keep = (/** @type {Buffer} */ b) => {
    log.write(b);
    for (const line of b.toString().split("\n")) if (line.trim()) tail.push(line);
    while (tail.length > 60) tail.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited = false;
  child.once("exit", () => {
    exited = true;
    log.end();
  });

  /** Graceful stop, then force after a grace period. */
  const stop = () =>
    new Promise((resolve) => {
      if (exited || child.pid === undefined) return resolve(undefined);
      const kill = (/** @type {NodeJS.Signals} */ sig) => {
        try {
          if (process.platform === "win32") child.kill(sig);
          else process.kill(-(/** @type {number} */ (child.pid)), sig);
        } catch {
          try {
            child.kill(sig);
          } catch {
            /* gone */
          }
        }
      };
      const t = setTimeout(() => kill("SIGKILL"), 3000);
      child.once("exit", () => (clearTimeout(t), resolve(undefined)));
      kill("SIGTERM");
    });

  return { child, stop, isAlive: () => !exited, tail: () => tail.join("\n") };
}

module.exports = { HOST, pickPort, startServer, waitForHttp };

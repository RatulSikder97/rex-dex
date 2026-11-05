// `npm run desktop:dev`: Electron shell against a Next dev server (Node ABI, ./data).
// Reuses a dev server already listening on REX_DEV_PORT (default 4747), otherwise starts one.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.REX_DEV_PORT || 4747);
const url = `http://localhost:${port}`;

const up = () =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => (res.resume(), resolve((res.statusCode ?? 0) < 500)));
    req.on("error", () => resolve(false));
    req.on("timeout", () => (req.destroy(), resolve(false)));
  });

let next = null;
if (!(await up())) {
  console.log(`[desktop] starting next dev on :${port}`);
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-p", String(port)], { cwd: root, stdio: "inherit" });
  for (let i = 0; i < 240 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
} else {
  console.log(`[desktop] using the dev server already running at ${url}`);
}

const electron = spawn(require("electron"), [path.join(root, "desktop", "app")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, REX_DESKTOP_URL: url },
});
const stop = () => next?.kill("SIGTERM");
electron.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => (electron.kill(), stop()));

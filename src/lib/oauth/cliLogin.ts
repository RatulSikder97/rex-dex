import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { opsEnv } from "../ops/exec";

/**
 * Browser sign-in through a provider's own CLI (gh, gcloud, …), run in the
 * background: the CLI opens the browser (REX opens any URL it prints), and a
 * one-time device code — if the CLI shows one — is surfaced in the REX UI.
 */

export interface CliLoginJob {
  id: string;
  connectionId: string;
  status: "running" | "done" | "error";
  /** Last lines of output (ANSI stripped). */
  output: string[];
  url: string | null;
  code: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const g = globalThis as unknown as { __rexCliLogins?: Map<string, CliLoginJob> };
const jobs: Map<string, CliLoginJob> = (g.__rexCliLogins ??= new Map());

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g;
const URL_RE = /https:\/\/[^\s"'<>)]+/;
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;

export function getCliLogin(id: string) {
  return jobs.get(id);
}

/** Latest job for a connection that's still useful to show (running, or finished in the last 2 minutes). */
export function activeCliLogin(connectionId: string): CliLoginJob | undefined {
  let best: CliLoginJob | undefined;
  for (const j of jobs.values()) if (j.connectionId === connectionId && (!best || j.startedAt > best.startedAt)) best = j;
  if (!best) return undefined;
  return best.status === "running" || Date.now() - (best.finishedAt ?? 0) < 120_000 ? best : undefined;
}

export function startCliLogin(connectionId: string, command: string, onDone?: () => void): CliLoginJob {
  const running = activeCliLogin(connectionId);
  if (running?.status === "running") return running;
  const job: CliLoginJob = { id: randomUUID(), connectionId, status: "running", output: [], url: null, code: null, error: null, startedAt: Date.now(), finishedAt: null };
  jobs.set(job.id, job);
  const child = spawn(/*turbopackIgnore: true*/ process.env.SHELL || "/bin/zsh", ["-lc", command], { env: { ...opsEnv(), BROWSER: "open" }, stdio: ["pipe", "pipe", "pipe"] });
  let openedUrl = false;
  const onData = (d: Buffer) => {
    for (const raw of d.toString("utf8").replace(ANSI, "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      job.output.push(line);
      if (job.output.length > 60) job.output.shift();
      const code = line.match(CODE_RE)?.[1];
      if (code && /code/i.test(line)) job.code = code;
      const url = line.match(URL_RE)?.[0];
      if (url && !job.url && !/brew\.sh|formulae|github\.com\/Homebrew/.test(url)) {
        job.url = url;
        // CLIs normally open it themselves; if not within 2s, REX opens it.
        setTimeout(() => {
          if (!openedUrl && job.status === "running" && process.platform === "darwin") {
            openedUrl = true;
            spawn("open", [url], { stdio: "ignore", detached: true }).unref();
          }
        }, 2000);
      }
      // gh asks "Press Enter to open github.com in your browser…"
      if (/press enter/i.test(line)) {
        openedUrl = true;
        child.stdin.write("\n");
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => {
    job.status = "error";
    job.error = e.message;
    job.finishedAt = Date.now();
  });
  child.on("close", (code) => {
    job.finishedAt = Date.now();
    if (code === 0) {
      job.status = "done";
      onDone?.();
    } else {
      job.status = "error";
      job.error = job.output.slice(-3).join(" ") || `Sign-in exited with code ${code}`;
    }
  });
  // Safety: give up after 15 minutes.
  setTimeout(() => job.status === "running" && child.kill("SIGTERM"), 15 * 60_000).unref();
  return job;
}

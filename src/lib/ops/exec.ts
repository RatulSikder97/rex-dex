import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "../agentEnv";

/** Common tool locations that a GUI-launched server's PATH may miss (Homebrew, Docker Desktop, gcloud). */
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function opsEnv(): NodeJS.ProcessEnv {
  const env = agentEnv();
  env.PATH = [...new Set([...(env.PATH ?? "").split(":").filter(Boolean), ...EXTRA_PATH])].join(":");
  return env;
}

/** Resolves the first existing binary among names (e.g. docker, then podman). */
export function findBin(names: string[]): string | null {
  const dirs = (opsEnv().PATH ?? "").split(":");
  for (const n of names) for (const d of dirs) {
    const p = path.join(/*turbopackIgnore: true*/ d, n);
    try {
      fs.accessSync(/*turbopackIgnore: true*/ p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/** execFile with argument arrays only (never a shell), a timeout and a size cap. */
export function run(bin: string, args: string[], opts: { cwd?: string; timeout?: number; input?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { cwd: opts.cwd, env: opsEnv(), timeout: opts.timeout ?? 20_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: unknown }).code as number | null) ?? null : 0;
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr).trim(), code: typeof code === "number" ? code : null });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/** First meaningful error line of a failed command. */
export function errorOf(r: ExecResult, fallback: string): string {
  const line = (r.stderr || r.stdout).split("\n").map((l) => l.trim()).find(Boolean);
  return (line ?? fallback).slice(0, 300);
}

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,252}$/;

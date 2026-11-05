import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-install secret that every API request must present (cookie set when the
 * app loads, or `x-rex-token` for the `rex` CLI and integrated terminals).
 * Stops other websites in the user's browser from driving the local REX engine.
 * Desktop app passes REX_SESSION_SECRET; otherwise it's kept in <data>/.session-secret.
 */
let cached: string | null = null;

export function sessionSecret(): string {
  if (cached) return cached;
  if (process.env.REX_SESSION_SECRET) return (cached = process.env.REX_SESSION_SECRET);
  const dir = process.env.REX_DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dir, ".session-secret");
  try {
    cached = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
    if (cached) return cached;
  } catch {
    /* create below */
  }
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  cached = randomBytes(32).toString("hex");
  fs.writeFileSync(/*turbopackIgnore: true*/ file, cached, { mode: 0o600 });
  return cached;
}

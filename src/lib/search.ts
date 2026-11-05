import "server-only";
import { spawn } from "node:child_process";
import { resolveInside, rgPath } from "./fsx";

const MAX_TOTAL_MATCHES = 2000;
const MAX_LINE_CHARS = 400;

export interface SearchMatch {
  line: number;
  text: string;
  /** [start, end) character offsets into `text`. */
  ranges: [number, number][];
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFileResult[];
  total: number;
  truncated: boolean;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  glob?: string;
}

type RgText = { text?: string; bytes?: string };
type RgMessage =
  | { type: "match"; data: { path: RgText; lines: RgText; line_number: number; submatches: { start: number; end: number }[] } }
  | { type: string; data: unknown };

function rgText(t: RgText): string {
  return t.text ?? Buffer.from(t.bytes ?? "", "base64").toString("utf8");
}

/** Converts a UTF-8 byte offset into a JS string (UTF-16) offset. */
function byteToCharOffset(s: string, byteOffset: number): number {
  return Buffer.from(s, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

export async function searchFiles(root: string, opts: SearchOptions): Promise<SearchResult> {
  const cwd = resolveInside(root, "");
  const rg = rgPath();
  if (!rg) throw new Error("ripgrep (rg) is not installed");
  const args = ["--json", "--max-count", "50", "--max-filesize", "1M", "--hidden", "--glob", "!.git"];
  if (!opts.regex) args.push("--fixed-strings");
  args.push(opts.caseSensitive ? "--case-sensitive" : "--ignore-case");
  for (const g of (opts.glob ?? "").split(",").map((s) => s.trim()).filter(Boolean)) args.push("--glob", g);
  args.push("--regexp", opts.query, "--", ".");

  return new Promise((resolve, reject) => {
    const child = spawn(rg, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const byFile = new Map<string, SearchFileResult>();
    let total = 0;
    let truncated = false;
    let pending = "";
    let stderr = "";

    const onLine = (line: string) => {
      if (!line || truncated) return;
      let msg: RgMessage;
      try {
        msg = JSON.parse(line) as RgMessage;
      } catch {
        return;
      }
      if (msg.type !== "match") return;
      const d = (msg as Extract<RgMessage, { type: "match" }>).data;
      const p = rgText(d.path).replace(/^\.\//, "");
      const raw = rgText(d.lines).replace(/\r?\n$/, "");
      let text = raw;
      let ranges: [number, number][] = d.submatches.map((m) => [byteToCharOffset(raw, m.start), byteToCharOffset(raw, m.end)]);
      if (text.length > MAX_LINE_CHARS) {
        // Keep the first match in view when trimming very long lines.
        const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 60);
        text = (start > 0 ? "…" : "") + raw.slice(start, start + MAX_LINE_CHARS);
        const shift = start > 0 ? start - 1 : 0;
        ranges = ranges.map(([a, b]) => [a - shift, Math.min(b - shift, text.length)] as [number, number]).filter(([a, b]) => a >= 0 && a < text.length && b > a);
      }
      let f = byFile.get(p);
      if (!f) byFile.set(p, (f = { path: p, matches: [] }));
      f.matches.push({ line: d.line_number, text, ranges });
      total++;
      if (total >= MAX_TOTAL_MATCHES) {
        truncated = true;
        child.kill();
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        onLine(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      if (stderr.length < 4000) stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (pending) onLine(pending);
      // 0 = matches, 1 = no matches, killed = we hit the cap.
      if (code === 2 && !truncated && !byFile.size) return reject(new Error(stderr.trim().replace(/\s+/g, " ").slice(0, 300) || "Search failed"));
      const files = [...byFile.values()].sort((a, b) => a.path.localeCompare(b.path));
      resolve({ files, total, truncated });
    });
  });
}

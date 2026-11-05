import "server-only";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSvgMarkup, renderSvgToPng } from "./raster";
import { exec } from "./ff";
import { registerImage, registerTts, type ImageProvider, type TtsProvider, type Voice } from "./providers";

// ---------------------------------------------------------------------------
// TTS: macOS `say`
// ---------------------------------------------------------------------------

const SAY = "/usr/bin/say";
/** Novelty/effect voices: still listed, but after the natural-sounding ones. */
const NOVELTY = new Set(["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Wobble", "Good News", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Zarvox", "Junior", "Ralph", "Fred", "Kathy"]);

let sayVoicesCache: Voice[] | null = null;

const sayProvider: TtsProvider = {
  id: "say",
  label: "macOS voices (say)",
  format: "aiff",
  async available() {
    return fs.existsSync(SAY) ? { ok: true, detail: "Offline system voices" } : { ok: false, detail: "Requires macOS (/usr/bin/say not found)" };
  },
  async voices() {
    if (sayVoicesCache) return sayVoicesCache;
    const { stdout } = await exec(SAY, ["-v", "?"]);
    const parsed = stdout
      .split("\n")
      .map((line) => /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#/.exec(line))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ name: m[1].trim(), locale: m[2] }));
    const rank = (v: { name: string; locale: string }) => (v.locale.startsWith("en_") ? (NOVELTY.has(v.name) ? 1 : 0) : 2);
    parsed.sort((a, b) => rank(a) - rank(b) || a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
    sayVoicesCache = parsed.map((v) => ({ id: v.name, label: `${v.name} (${v.locale})` }));
    return sayVoicesCache;
  },
  async synthesize({ text, voice, outPath, signal }) {
    // Text goes through a file, never argv.
    const txt = path.join(os.tmpdir(), `rex-say-${randomUUID()}.txt`);
    fs.writeFileSync(/*turbopackIgnore: true*/ txt, text, "utf8");
    try {
      const args = ["-f", txt, "-o", outPath];
      if (voice) args.unshift("-v", voice);
      await exec(SAY, args, signal);
    } finally {
      fs.rmSync(/*turbopackIgnore: true*/ txt, { force: true });
    }
    if (!fs.existsSync(/*turbopackIgnore: true*/ outPath)) throw new Error("say produced no audio");
  },
};

// ---------------------------------------------------------------------------
// Image: title card (offline SVG template)
// ---------------------------------------------------------------------------

const PALETTES: [string, string, string][] = [
  ["#0f2027", "#2c5364", "#7dd3fc"],
  ["#1a1033", "#4c1d95", "#f0abfc"],
  ["#0b1d14", "#14532d", "#86efac"],
  ["#1f0f0a", "#7c2d12", "#fdba74"],
  ["#0a1128", "#1e3a8a", "#93c5fd"],
  ["#1c1917", "#44403c", "#fcd34d"],
  ["#160b1f", "#831843", "#fda4af"],
  ["#03191e", "#115e59", "#5eead4"],
];

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

export function titleCardSvg(prompt: string, width: number, height: number): string {
  const headline = prompt.trim().replace(/\s+/g, " ") || "Untitled";
  const hash = createHash("sha256").update(headline).digest();
  const [c0, c1, accent] = PALETTES[hash[0] % PALETTES.length];
  const angle = (hash[1] / 255) * 360;
  const minSide = Math.min(width, height);
  // Font size shrinks for long headlines; ~0.55em average glyph width.
  let fontSize = Math.round(minSide * (headline.length > 80 ? 0.065 : headline.length > 40 ? 0.08 : 0.1));
  const usable = width * 0.8;
  let lines = wrap(headline, Math.max(8, Math.floor(usable / (fontSize * 0.55))), 6);
  while (lines.length > 5 && fontSize > minSide * 0.045) {
    fontSize = Math.round(fontSize * 0.88);
    lines = wrap(headline, Math.max(8, Math.floor(usable / (fontSize * 0.55))), 6);
  }
  const lh = fontSize * 1.18;
  const blockH = lines.length * lh;
  const startY = height / 2 - blockH / 2 + fontSize * 0.85;
  const circles = Array.from({ length: 5 }, (_, i) => {
    const cx = ((hash[2 + i * 3] / 255) * 1.2 - 0.1) * width;
    const cy = ((hash[3 + i * 3] / 255) * 1.2 - 0.1) * height;
    const r = (0.12 + (hash[4 + i * 3] / 255) * 0.35) * minSide;
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${i % 2 ? accent : "#ffffff"}" opacity="${i % 2 ? 0.12 : 0.05}"/>`;
  }).join("");
  const barW = minSide * 0.12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle.toFixed(0)} .5 .5)">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="1" stop-color="${c1}"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".6">
      <stop offset="0" stop-color="${accent}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="${(minSide * 0.04).toFixed(0)}"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <g filter="url(#blur)">${circles}</g>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect x="${(width - barW) / 2}" y="${(startY - fontSize * 0.85 - fontSize * 0.9).toFixed(0)}" width="${barW.toFixed(0)}" height="${Math.max(4, minSide * 0.008).toFixed(0)}" rx="3" fill="${accent}"/>
  <g font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">
    ${lines.map((l, i) => `<text x="${width / 2}" y="${(startY + i * lh).toFixed(0)}">${xml(l)}</text>`).join("\n    ")}
  </g>
</svg>`;
}

const titleCard: ImageProvider = {
  id: "title-card",
  label: "Title cards (offline)",
  async available() {
    return { ok: true, detail: "Instant gradient title cards, no network" };
  },
  async generate({ prompt, width, height, outPath }) {
    fs.writeFileSync(/*turbopackIgnore: true*/ outPath, renderSvgToPng(titleCardSvg(prompt, width, height), width));
  },
};

// ---------------------------------------------------------------------------
// Image: Claude-designed SVG scene
// ---------------------------------------------------------------------------

const svgDesign: ImageProvider = {
  id: "svg-design",
  label: "Claude SVG illustrations",
  async available() {
    return { ok: true, detail: "Design department's terminal agent" };
  },
  async generate({ prompt, width, height, outPath, signal }) {
    const { runToText } = await import("../runs");
    signal?.throwIfAborted();
    const brief = `Design a full-bleed scene illustration as a single SVG for a video frame.
Canvas: exactly ${width}x${height}. Use width="${width}" height="${height}" viewBox="0 0 ${width} ${height}".
Fill the entire canvas (background rect first). Rich but clean vector art: layered shapes, gradients, depth, a clear focal subject.
Do NOT include any text, letters, logos or watermarks. No <script>, no <foreignObject>, no external images or fonts.
Respond with ONLY the SVG markup.

Scene: ${prompt}`;
    // Models occasionally emit malformed markup; one retry with a stricter reminder.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await runToText({
        department: "design",
        brief: attempt ? `${brief}\n\nThe previous attempt was not valid XML. Return well-formed SVG only: every attribute value double-quoted, every tag closed.` : brief,
      });
      signal?.throwIfAborted();
      try {
        fs.writeFileSync(/*turbopackIgnore: true*/ outPath, renderSvgToPng(extractSvgMarkup(text, width, height), width));
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  },
};

export function registerBuiltinProviders() {
  registerTts(sayProvider);
  registerImage(titleCard);
  registerImage(svgDesign);
}

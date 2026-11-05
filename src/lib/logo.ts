import "server-only";
import { extractJson, runToText } from "./runs";
import { getProject, updateProject } from "./repo";

/**
 * Project logos: the Design department drafts a few square SVG marks; the
 * chosen one is stored on the project. SVG is sanitized and only ever rendered
 * through an <img> data URL (scripts can't run there), never inlined.
 */

const MAX_SVG = 600_000;

export function sanitizeSvg(raw: string): string {
  const m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new Error("No <svg> found");
  let svg = m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    // Only in-document refs (#id) and embedded raster images (uploaded PNG/JPG) are kept.
    .replace(/(href|xlink:href)\s*=\s*("(?!#|data:image\/(png|jpeg|webp);base64,)[^"]*"|'(?!#|data:image\/(png|jpeg|webp);base64,)[^']*')/gi, "")
    .replace(/<\?xml[^>]*>/g, "");
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (svg.length > MAX_SVG) throw new Error("Logo SVG is too large");
  return svg;
}

export async function generateLogoOptions(projectId: string, hint?: string): Promise<string[]> {
  const p = getProject(projectId);
  if (!p) throw new Error("Project not found");
  const brief = `Design 3 distinct logo marks (app icons) for this product.

Product: ${p.name}
What it is: ${p.description || "n/a"}
Website: ${p.website_url || "n/a"}
${hint ? `Direction from the founder: ${hint}\n` : ""}
Requirements for EACH logo:
- One self-contained SVG, width="256" height="256" viewBox="0 0 256 256", square, a rounded-square or full-bleed background shape.
- A bold, simple, memorable symbol that reads at 16px (favicon) and 256px. Max 2–3 colors, flat or a subtle gradient.
- No text except at most one or two letters if they ARE the mark. No external images/fonts, no <script>, no <foreignObject>.
- Make the 3 options genuinely different concepts (e.g. abstract geometric, monogram, symbolic).

Respond with ONLY JSON: {"logos":[{"concept":"one line","svg":"<svg ...>...</svg>"}, …]}`;
  const text = await runToText({ department: "design", brief, projectId });
  let svgs: string[] = [];
  try {
    const j = extractJson<{ logos?: { svg?: string }[] }>(text);
    svgs = (j.logos ?? []).map((l) => l.svg ?? "").filter(Boolean);
  } catch {
    svgs = text.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
  }
  const out: string[] = [];
  for (const s of svgs) {
    try {
      out.push(sanitizeSvg(s));
    } catch {
      /* skip broken option */
    }
  }
  if (!out.length) throw new Error("The Design agent didn't return a usable SVG — try again");
  return out.slice(0, 4);
}

export function setProjectLogo(projectId: string, svg: string) {
  return updateProject(projectId, { logo: svg ? sanitizeSvg(svg) : "" });
}

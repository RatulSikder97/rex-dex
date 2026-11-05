import "server-only";
import { Resvg } from "@resvg/resvg-js";

/** Rasterize SVG to PNG with system fonts. Never rendered in a browser. */
export function renderSvgToPng(svg: string, width: number): Buffer {
  const r = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
    fitTo: { mode: "width", value: width },
  });
  return r.render().asPng();
}

/**
 * Pull the first <svg>…</svg> out of model text and make it safe + sized:
 * scripts, foreignObject and non-data hrefs are stripped; width/height are
 * forced to the target and a missing viewBox is set to it. A model viewBox that
 * differs from the target is kept and filled with `slice` so nothing distorts.
 */
export function extractSvgMarkup(text: string, width: number, height: number): string {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) throw new Error("The model did not return an SVG");
  let svg = m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!data:|#)[^"]*"|'(?!data:|#)[^']*')/gi, "");
  svg = svg.replace(/<svg\b([^>]*)>/i, (_all, attrs: string) => {
    const hasViewBox = /\sviewBox\s*=/i.test(attrs);
    let a = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    if (!hasViewBox) a += ` viewBox="0 0 ${width} ${height}"`;
    if (!/\sxmlns\s*=/i.test(a)) a += ` xmlns="http://www.w3.org/2000/svg"`;
    return `<svg${a} width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">`;
  });
  return svg;
}

// Rasterizes desktop/build/icon*.svg into the platform icon set:
//   desktop/build/icon.icns (macOS, via iconutil), icon.ico (Windows), icon.png (Linux, 1024)
//   desktop/app/assets/icon.png (window icon on Linux)
// Usage: node desktop/scripts/icons.mjs
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build");
const svgFull = fs.readFileSync(path.join(build, "icon.svg"), "utf8");
const svgMac = fs.readFileSync(path.join(build, "icon-mac.svg"), "utf8");

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" }).render().asPng();

// Linux / generic
fs.writeFileSync(path.join(build, "icon.png"), render(svgFull, 1024));
fs.mkdirSync(path.join(root, "app", "assets"), { recursive: true });
fs.writeFileSync(path.join(root, "app", "assets", "icon.png"), render(svgFull, 512));

// Windows .ico: PNG-compressed entries (Vista+).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = icoSizes.map((s) => render(svgFull, s));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const s = icoSizes[i];
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
fs.writeFileSync(path.join(build, "icon.ico"), Buffer.concat([header, ...images]));

// macOS .icns
if (process.platform === "darwin") {
  const set = fs.mkdtempSync(path.join(os.tmpdir(), "rex-icon-")) + "/icon.iconset";
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${s}x${s}.png`), render(svgMac, s));
    fs.writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), render(svgMac, s * 2));
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(build, "icon.icns")]);
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
} else {
  console.warn("icon.icns not regenerated (needs macOS iconutil)");
}
console.log("icons written to", build);

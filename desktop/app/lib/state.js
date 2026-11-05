// @ts-check
"use strict";
/**
 * Small JSON store in userData/desktop-state.json: window bounds, the stable
 * server port (localStorage is per-origin, so the port must not change between
 * launches or every UI preference would reset) and the last theme colors (so the
 * window background matches before the page paints).
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, screen } = require("electron");

/**
 * @typedef {{ x?: number; y?: number; width: number; height: number; maximized?: boolean; fullscreen?: boolean }} Bounds
 * @typedef {{ bg: string; title: string; fg: string }} ThemeColors
 * @typedef {{ bounds?: Bounds; port?: number; theme?: ThemeColors }} DesktopState
 */

const file = () => path.join(app.getPath("userData"), "desktop-state.json");

/** @returns {DesktopState} */
function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}

/** @param {Partial<DesktopState>} patch */
function save(patch) {
  const next = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch {
    /* non-fatal */
  }
  return next;
}

/**
 * Saved bounds if they are still on a connected display; otherwise centered defaults.
 * @param {Bounds | undefined} b
 * @returns {Bounds}
 */
function usableBounds(b) {
  const def = { width: 1440, height: 900 };
  if (!b || !b.width || !b.height) return def;
  if (b.x === undefined || b.y === undefined) return { ...def, width: b.width, height: b.height, maximized: b.maximized };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 100 < a.x + a.width && b.x + b.width - 100 > a.x && b.y >= a.y - 10 && b.y < a.y + a.height - 50;
  });
  return visible ? b : { ...def, width: b.width, height: b.height, maximized: b.maximized };
}

module.exports = { load, save, usableBounds };

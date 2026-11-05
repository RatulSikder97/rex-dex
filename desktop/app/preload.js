// @ts-check
"use strict";
/**
 * Sandboxed preload. Exposes a small, explicit `window.rexDesktop` API (typed in
 * src/lib/desktop.ts) — no Node access reaches the page.
 */
const { contextBridge, ipcRenderer } = require("electron");

const platform = process.platform;
const version = (process.argv.find((a) => a.startsWith("--rex-version=")) ?? "").split("=")[1] ?? "";

contextBridge.exposeInMainWorld("rexDesktop", {
  isDesktop: true,
  platform,
  version,
  /** @param {{ title?: string; message?: string; defaultPath?: string | null; buttonLabel?: string }} [opts] */
  pickFolder: (opts) => ipcRenderer.invoke("rex:pick-folder", opts ?? {}),
  /** @param {string} title @param {string} [body] */
  notify: (title, body) => ipcRenderer.send("rex:notify", { title: String(title), body: body ? String(body) : "" }),
  /** @param {number} count */
  setBadge: (count) => ipcRenderer.send("rex:badge", Math.max(0, Math.floor(Number(count) || 0))),
  /** @param {unknown} menus */
  setMenu: (menus) => ipcRenderer.send("rex:set-menu", menus),
  /** @param {(id: string) => void} cb */
  onMenu: (cb) => {
    const h = (/** @type {unknown} */ _e, /** @type {{ id: string }} */ msg) => cb(msg.id);
    ipcRenderer.on("rex:menu", h);
    return () => ipcRenderer.removeListener("rex:menu", h);
  },
});

// ---- Document flags for desktop-only CSS (title-bar insets, drag region).
const flag = () => {
  const el = document.documentElement;
  if (!el) return;
  el.dataset.rexDesktop = platform;
};
ipcRenderer.on("rex:fullscreen", (_e, on) => {
  if (on) document.documentElement.dataset.rexFullscreen = "";
  else delete document.documentElement.dataset.rexFullscreen;
});

// ---- Theme colors → native window background / Windows-Linux title-bar overlay.
let lastColors = "";
const reportTheme = () => {
  const bar = document.querySelector(".titlebar");
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const title = bar ? getComputedStyle(bar).backgroundColor : bodyBg;
  const fg = getComputedStyle(bar ?? document.body).color;
  const colors = JSON.stringify({ bg: bodyBg, title, fg });
  if (colors === lastColors || !bodyBg || bodyBg === "rgba(0, 0, 0, 0)") return;
  lastColors = colors;
  ipcRenderer.send("rex:theme", { bg: bodyBg, title, fg });
};
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(reportTheme, 120);
};

flag();
window.addEventListener("DOMContentLoaded", () => {
  flag();
  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-color-theme", "data-color-theme-kind"] });
  // The title bar mounts after boot/hydration: watch the tree until it appears.
  const mount = new MutationObserver(() => {
    if (!document.querySelector(".titlebar")) return;
    mount.disconnect();
    schedule();
  });
  mount.observe(document.body, { childList: true, subtree: true });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
});

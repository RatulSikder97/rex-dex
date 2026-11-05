// @ts-check
"use strict";
/**
 * macOS application menu. The renderer owns the menu model (MenuBar.tsx sends it
 * via `rexDesktop.setMenu`), so native items always match REX's in-app actions,
 * checked states and enabled states. Clicking one sends `rex:menu` {id} back.
 * Standard roles (Edit clipboard, Window, Hide/Quit) are native so copy/paste/undo
 * work in every input.
 *
 * Accelerators are shown but not registered: REX's own key handler already owns
 * those shortcuts, registering them natively would run each action twice.
 */
const { Menu, app } = require("electron");

/**
 * @typedef {{ id?: string; label?: string; type?: "separator" | "header" | "submenu"; hint?: string; checked?: boolean; disabled?: boolean; items?: ModelItem[] }} ModelItem
 * @typedef {{ id: string; label: string; items: ModelItem[] }} ModelMenu
 * @typedef {Electron.MenuItemConstructorOptions} Item
 */

const KEY_NAMES = /** @type {Record<string, string>} */ ({ "←": "Left", "→": "Right", "↑": "Up", "↓": "Down", "⏎": "Return", "⌫": "Backspace", "⎋": "Escape" });

/**
 * "⌥⌘R" → "Alt+Command+R". Chords ("⌘K ⌘T") have no native equivalent: undefined.
 * @param {string | undefined} hint
 */
function toAccelerator(hint) {
  if (!hint || /\s/.test(hint.trim())) return undefined;
  const mods = [];
  if (hint.includes("⌃")) mods.push("Control");
  if (hint.includes("⌥")) mods.push("Alt");
  if (hint.includes("⇧")) mods.push("Shift");
  if (hint.includes("⌘")) mods.push("Command");
  let key = hint.replace(/[⌘⌃⇧⌥]/g, "");
  key = KEY_NAMES[key] ?? key;
  if (!key || !mods.length) return undefined;
  if (key === "=") key = "Plus";
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join("+");
}

/**
 * @param {ModelItem[]} items
 * @param {(id: string) => void} send
 * @returns {Item[]}
 */
function toItems(items, send) {
  /** @type {Item[]} */
  const out = [];
  for (const it of items) {
    if (it.type === "separator") {
      if (out.length && out[out.length - 1].type !== "separator") out.push({ type: "separator" });
      continue;
    }
    if (it.type === "header") {
      out.push({ label: it.label ?? "", enabled: false });
      continue;
    }
    if (it.type === "submenu") {
      out.push({ label: it.label ?? "", enabled: !it.disabled, submenu: toItems(it.items ?? [], send) });
      continue;
    }
    const accelerator = toAccelerator(it.hint);
    const id = it.id;
    out.push({
      label: it.label ?? "",
      type: typeof it.checked === "boolean" ? "checkbox" : "normal",
      checked: !!it.checked,
      enabled: !it.disabled,
      ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
      click: () => id && send(id),
    });
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  while (out.length && out[0].type === "separator") out.shift();
  return out;
}

const CLIPBOARD = new Set(["Undo", "Redo", "Cut", "Copy", "Paste"]);

/**
 * @param {{ model: ModelMenu[] | null; send: (id: string) => void; dev: boolean; onReload: () => void }} o
 */
function buildMacMenu(o) {
  const name = app.name;
  const byId = new Map((o.model ?? []).map((m) => [m.id, m]));
  const items = (/** @type {string} */ id) => toItems(byId.get(id)?.items ?? [], o.send);
  const sep = /** @type {Item} */ ({ type: "separator" });

  const appItems = items("app");
  /** @type {Item[]} */
  const template = [
    {
      label: name,
      submenu: [
        ...(appItems.length ? appItems : [{ role: /** @type {const} */ ("about") }]),
        sep,
        { role: "services" },
        sep,
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        sep,
        { role: "quit" },
      ],
    },
  ];
  if (byId.has("file")) template.push({ label: "File", submenu: items("file") });

  const editExtra = toItems((byId.get("edit")?.items ?? []).filter((i) => !CLIPBOARD.has(i.label ?? "")), o.send);
  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      sep,
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "selectAll" },
      ...(editExtra.length ? [sep, ...editExtra] : []),
    ],
  });
  if (byId.has("selection")) template.push({ label: "Selection", submenu: items("selection") });

  template.push({
    label: "View",
    submenu: [
      ...items("view"),
      sep,
      { role: "togglefullscreen" },
      { label: "Reload Window", ...(o.dev ? { accelerator: "Command+Shift+R" } : {}), click: o.onReload },
      ...(o.dev ? /** @type {Item[]} */ ([{ role: "toggleDevTools", accelerator: "Alt+Command+I" }]) : []),
    ],
  });
  for (const id of ["go", "terminal", "agents"]) {
    const m = byId.get(id);
    if (m) template.push({ label: m.label, submenu: items(id) });
  }
  // Default macOS Window menu: Minimize, Zoom, Bring All to Front (no ⌘W Close: REX uses ⌘W for tabs).
  template.push({ role: "windowMenu" });
  template.push({ role: "help", submenu: items("help") });
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMacMenu, toAccelerator };

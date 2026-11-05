// @ts-check
"use strict";
/**
 * REX desktop shell (Electron main process).
 *
 *   splash → resolve login-shell env + stable port → start the bundled REX engine
 *   (Next.js standalone server, run by Electron's own Node) → wait until it answers
 *   → main window on http://127.0.0.1:<port>.
 *
 * Dev: `npm run desktop:dev` sets REX_DESKTOP_URL to the running `next dev` server
 * and no engine is spawned.
 */
const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeTheme, session, shell } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");
const state = require("./lib/state");
const { resolveShellEnv, mergedEnv } = require("./lib/shellEnv");
const { HOST, pickPort, startServer, waitForHttp } = require("./lib/server");
const { buildMacMenu } = require("./lib/menu");

const isMac = process.platform === "darwin";
const DEV_URL = process.env.REX_DESKTOP_URL || "";
const isDev = !!DEV_URL || !app.isPackaged;
const TITLE_BAR_HEIGHT = 34;
const DEFAULT_THEME = { bg: "#0b0d12", title: "#0f1117", fg: "#c9cdd6" };

app.setName("REX");
if (process.platform === "win32") app.setAppUserModelId("com.rex.workbench");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  /** @type {BrowserWindow | null} */
  let win = null;
  /** @type {BrowserWindow | null} */
  let splash = null;
  /** @type {ReturnType<typeof startServer> | null} */
  let engine = null;
  let appUrl = "";
  let quitting = false;
  /** @type {unknown} */
  let menuModel = null;
  let menuJson = "";
  const saved = state.load();
  let theme = saved.theme ?? DEFAULT_THEME;
  const logFile = path.join(app.getPath("userData"), "logs", "server.log");

  const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "stage", "server");

  /** @param {string} url */
  const isLocal = (url) => {
    try {
      return !!appUrl && new URL(url).origin === new URL(appUrl).origin;
    } catch {
      return false;
    }
  };

  // window.open(url, "rex-oauth") falls back to window.open(url, "_blank") when the
  // first call is denied — open each external URL once.
  let lastExternal = { url: "", at: 0 };
  /** @param {string} url */
  const openExternal = (url) => {
    if (!/^(https?|mailto):/i.test(url)) return;
    if (lastExternal.url === url && Date.now() - lastExternal.at < 2000) return;
    lastExternal = { url, at: Date.now() };
    void shell.openExternal(url);
  };

  const focusMain = () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  app.on("second-instance", focusMain);

  // ---------------------------------------------------------------- splash
  function showSplash() {
    splash = new BrowserWindow({
      width: 420,
      height: 300,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      center: true,
      backgroundColor: "#0b0d12",
      title: "REX",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    splash.once("ready-to-show", () => splash?.show());
    splash.on("closed", () => (splash = null));
    void splash.loadFile(path.join(__dirname, "splash.html"));
  }

  // ---------------------------------------------------------------- main window
  function persistBounds() {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    state.save({ bounds: { ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() } });
  }

  function createWindow() {
    const bounds = state.usableBounds(state.load().bounds);
    win = new BrowserWindow({
      ...(bounds.x !== undefined ? { x: bounds.x, y: bounds.y } : {}),
      width: bounds.width,
      height: bounds.height,
      minWidth: 1024,
      minHeight: 680,
      show: false,
      title: "REX",
      backgroundColor: theme.bg,
      ...(isMac
        ? { titleBarStyle: /** @type {const} */ ("hiddenInset"), trafficLightPosition: { x: 13, y: 11 } }
        : { titleBarStyle: /** @type {const} */ ("hidden"), titleBarOverlay: { color: theme.title, symbolColor: theme.fg, height: TITLE_BAR_HEIGHT } }),
      ...(process.platform === "linux" ? { icon: path.join(__dirname, "assets", "icon.png") } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        additionalArguments: [`--rex-version=${app.getVersion()}`],
      },
    });
    const w = win;
    w.once("ready-to-show", () => {
      if (bounds.maximized) w.maximize();
      w.show();
      if (bounds.fullscreen) w.setFullScreen(true);
      splash?.destroy();
    });

    let t = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
    const later = () => (clearTimeout(t), (t = setTimeout(persistBounds, 400)));
    w.on("resize", later);
    w.on("move", later);
    w.on("close", persistBounds);
    w.on("closed", () => (win = null));
    w.on("enter-full-screen", () => w.webContents.send("rex:fullscreen", true));
    w.on("leave-full-screen", () => w.webContents.send("rex:fullscreen", false));

    const wc = w.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isLocal(url)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: { backgroundColor: theme.bg, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } },
        };
      }
      openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (e, url) => {
      if (isLocal(url)) return;
      e.preventDefault();
      openExternal(url);
    });
    wc.on("render-process-gone", (_e, d) => {
      if (d.reason !== "clean-exit" && !quitting) wc.reload();
    });
    if (!isMac && isDev) {
      wc.on("before-input-event", (_e, input) => {
        if (input.type === "keyDown" && input.key === "F12") wc.toggleDevTools();
      });
    }
    void w.loadURL(appUrl);
    return w;
  }

  // ---------------------------------------------------------------- menu
  function applyMenu() {
    if (!isMac) {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(
      buildMacMenu({
        model: /** @type {any} validated shape from the renderer, see src/lib/desktop.ts */ (menuModel),
        send: (id) => win?.webContents.send("rex:menu", { id }),
        dev: isDev,
        onReload: () => win?.webContents.reload(),
      }),
    );
  }

  // ---------------------------------------------------------------- IPC (main window only)
  /** @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} e */
  const trusted = (e) => !!win && e.sender === win.webContents && isLocal(e.senderFrame?.url ?? "");

  ipcMain.handle("rex:pick-folder", async (e, opts) => {
    if (!trusted(e) || !win) return null;
    const o = opts && typeof opts === "object" ? opts : {};
    const r = await dialog.showOpenDialog(win, {
      title: typeof o.title === "string" ? o.title : "Choose a folder",
      message: typeof o.message === "string" ? o.message : undefined,
      buttonLabel: typeof o.buttonLabel === "string" ? o.buttonLabel : undefined,
      defaultPath: typeof o.defaultPath === "string" && o.defaultPath ? o.defaultPath : undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.on("rex:notify", (e, msg) => {
    if (!trusted(e) || !Notification.isSupported() || win?.isFocused()) return;
    const n = new Notification({ title: String(msg?.title ?? "REX").slice(0, 120), body: String(msg?.body ?? "").slice(0, 400) });
    n.on("click", focusMain);
    n.show();
  });

  ipcMain.on("rex:badge", (e, count) => {
    if (!trusted(e)) return;
    const n = Math.max(0, Math.min(999, Number(count) || 0));
    if (isMac) app.dock?.setBadge(n ? String(n) : "");
    else app.setBadgeCount(n);
  });

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let menuTimer;
  ipcMain.on("rex:set-menu", (e, model) => {
    if (!trusted(e) || !isMac || !Array.isArray(model)) return;
    const json = JSON.stringify(model);
    if (json === menuJson || json.length > 500_000) return;
    menuJson = json;
    menuModel = model;
    clearTimeout(menuTimer);
    menuTimer = setTimeout(applyMenu, 60);
  });

  const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]+\))$/i;
  ipcMain.on("rex:theme", (e, c) => {
    if (!trusted(e) || !win || !c || !COLOR.test(c.bg) || !COLOR.test(c.title) || !COLOR.test(c.fg)) return;
    theme = { bg: c.bg, title: c.title, fg: c.fg };
    win.setBackgroundColor(theme.bg);
    if (!isMac) win.setTitleBarOverlay({ color: theme.title, symbolColor: theme.fg, height: TITLE_BAR_HEIGHT });
    state.save({ theme });
  });

  // ---------------------------------------------------------------- engine
  async function boot() {
    if (DEV_URL) {
      appUrl = DEV_URL.replace(/\/$/, "");
      await waitForHttp(`${appUrl}/`, { timeoutMs: 120000 });
      return;
    }
    const [shellEnv, port] = await Promise.all([resolveShellEnv(), pickPort(state.load().port)]);
    state.save({ port });
    engine = startServer({
      serverDir,
      port,
      dataDir: path.join(app.getPath("userData"), "data"),
      secret: crypto.randomBytes(32).toString("hex"),
      env: mergedEnv(shellEnv),
      logFile,
    });
    const e = engine;
    appUrl = `http://${HOST}:${port}`;
    e.child.once("exit", (code, signal) => {
      if (quitting) return;
      void engineCrashed(`exit code ${code ?? "–"}${signal ? `, signal ${signal}` : ""}`, e.tail());
    });
    await waitForHttp(`${appUrl}/`, { timeoutMs: 90000, isAlive: e.isAlive });
  }

  /** @param {string} why @param {string} tail */
  async function engineCrashed(why, tail) {
    const r = await dialog.showMessageBox({
      type: "error",
      title: "REX",
      message: "The REX engine stopped unexpectedly.",
      detail: `${why}\n\n${tail.split("\n").slice(-12).join("\n")}\n\nLog: ${logFile}`,
      buttons: ["Restart", "Show Log", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (r.response === 1) shell.showItemInFolder(logFile);
    if (r.response === 2 || r.response === 1) {
      app.quit();
      return;
    }
    try {
      await boot();
      if (win) void win.loadURL(appUrl);
      else createWindow();
    } catch (err) {
      fatal(err);
    }
  }

  /** @param {unknown} err */
  function fatal(err) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox("REX could not start", `${msg}\n\n${engine?.tail().split("\n").slice(-15).join("\n") ?? ""}\n\nLog: ${logFile}`);
    quitting = true;
    void engine?.stop().finally(() => app.exit(1));
    if (!engine) app.exit(1);
  }

  // ---------------------------------------------------------------- lifecycle
  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: "REX", applicationVersion: app.getVersion(), copyright: `© ${new Date().getFullYear()} REX` });
    nativeTheme.themeSource = "system";
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => {
      const allowed = ["clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen", "media"];
      cb(isLocal(details.requestingUrl) && allowed.includes(perm));
    });
    applyMenu();
    showSplash();
    try {
      await boot();
    } catch (err) {
      fatal(err);
      return;
    }
    createWindow();
  });

  app.on("activate", () => {
    if (!win && appUrl && !quitting) createWindow();
    else focusMain();
  });

  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });

  app.on("before-quit", (e) => {
    persistBounds();
    if (quitting || !engine?.isAlive()) {
      quitting = true;
      return;
    }
    e.preventDefault();
    quitting = true;
    void engine.stop().finally(() => app.quit());
  });
}

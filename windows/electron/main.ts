// electron/main.ts
import { app, BrowserWindow, ipcMain, powerSaveBlocker, globalShortcut  } from "electron";
import path from "node:path";

import fs from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
const streamPipeline = promisify(pipeline);

// ✅ Auto update
import log from "electron-log";
import { autoUpdater } from "electron-updater";

const MEDIA_DIR = path.join(app.getPath("userData"), "media-cache");
const INDEX_FILE = path.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MEDIA_PROXY_PORT = Number(process.env.MEDIA_PROXY_PORT || 17654);
const MEDIA_PROXY_HOST = "127.0.0.1";
const MEDIA_PROXY_ALLOWED_HOSTS = new Set(
  [
    "192.168.10.16",
    process.env.VITE_REVERB_HOST,
    process.env.MEDIA_SERVER_HOST,
    process.env.SERVER_HOST,
  ]
    .filter(Boolean)
    .map((host) => String(host).trim().toLowerCase())
);
const MEDIA_PROXY_EXPOSED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

type IndexRec = { p: string; s: number; t: number };
type IndexMap = Record<string, IndexRec>;

let mediaProxyServer: http.Server | null = null;

function addMediaProxyCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Accept, Origin"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges"
  );
  res.setHeader("Accept-Ranges", "bytes");
}

function isPrivateLanHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return MEDIA_PROXY_ALLOWED_HOSTS.has(host);
}

function parseAllowedMediaUrl(value: string | null) {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    if (!target.pathname.includes("/storage/")) return null;
    if (!isPrivateLanHost(target.hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

function copyMediaHeaders(remote: Response, res: http.ServerResponse) {
  for (const headerName of MEDIA_PROXY_EXPOSED_HEADERS) {
    const value = remote.headers.get(headerName);
    if (value) res.setHeader(headerName, value);
  }
  if (!remote.headers.get("accept-ranges")) {
    res.setHeader("Accept-Ranges", "bytes");
  }
}

function startMediaProxy() {
  if (mediaProxyServer) return;

  mediaProxyServer = http.createServer(async (req, res) => {
    addMediaProxyCorsHeaders(res);

    if (!req.url) {
      res.writeHead(400).end("Bad request");
      return;
    }

    const requestUrl = new URL(req.url, `http://${MEDIA_PROXY_HOST}:${MEDIA_PROXY_PORT}`);
    if (requestUrl.pathname !== "/media-proxy") {
      res.writeHead(404).end("Not found");
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method not allowed");
      return;
    }

    const targetUrl = parseAllowedMediaUrl(requestUrl.searchParams.get("url"));
    if (!targetUrl) {
      res.writeHead(400).end("Invalid media URL");
      return;
    }

    const abort = new AbortController();
    req.on("close", () => abort.abort());

    try {
      const headers: Record<string, string> = {};
      const range = req.headers.range;
      if (range) headers.Range = String(range);

      const remote = await fetch(targetUrl.toString(), {
        method: req.method,
        headers,
        redirect: "follow",
        signal: abort.signal,
      });

      copyMediaHeaders(remote, res);
      res.writeHead(remote.status);

      if (req.method === "HEAD" || !remote.body) {
        res.end();
        return;
      }

      await streamPipeline(remote.body as any, res);
    } catch (e: any) {
      if (abort.signal.aborted || res.headersSent) return;
      res.writeHead(502).end(e?.message || "Media proxy error");
    }
  });

  mediaProxyServer.on("error", (e) => {
    log.error("Media proxy error", e);
  });

  mediaProxyServer.listen(MEDIA_PROXY_PORT, MEDIA_PROXY_HOST, () => {
    log.info(
      `Media proxy listening on http://${MEDIA_PROXY_HOST}:${MEDIA_PROXY_PORT}`
    );
  });
}

function stopMediaProxy() {
  if (!mediaProxyServer) return;
  mediaProxyServer.close();
  mediaProxyServer = null;
}

function ensureDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
function loadIndex(): IndexMap {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveIndex(ix: IndexMap) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(ix), "utf8");
}
function keyFor(url: string) {
  return createHash("sha1").update(url).digest("hex");
}
function sizeOf(file: string) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
function totalSize(ix: IndexMap) {
  return Object.values(ix).reduce((a, r) => a + (r.s || 0), 0);
}

export interface DeviceState {
  code?: string;
  screenId?: string;
  [key: string]: unknown;
}

async function evictIfNeeded(ix: IndexMap) {
  let sz = totalSize(ix);
  if (sz <= MAX_BYTES) return;
  const entries = Object.entries(ix).sort((a, b) => a[1].t - b[1].t); // LRU
  for (const [k, rec] of entries) {
    try {
      fs.unlinkSync(rec.p);
    } catch {}
    delete ix[k];
    sz = totalSize(ix);
    if (sz <= MAX_BYTES) break;
  }
  saveIndex(ix);
}

async function downloadToFile(url: string, dst: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = fs.createWriteStream(dst);
  await streamPipeline(res.body as any, file);
}

/* ──────────────────────────────────────────────────────────────
   IPC: media cache
────────────────────────────────────────────────────────────── */

ipcMain.handle("media-cache:map", async (_evt, urls: string[]) => {
  ensureDir();
  const ix = loadIndex();
  const results: Record<string, string> = {};

  for (const url of urls) {
    const k = keyFor(url);
    const rec = ix[k];
    if (rec && fs.existsSync(rec.p)) {
      rec.t = Date.now();
      results[url] = `file://${rec.p.replace(/\\/g, "/")}`;
      continue;
    }
    const ext = path.extname(new URL(url).pathname) || "";
    const dst = path.join(MEDIA_DIR, `${k}${ext}`);
    try {
      await downloadToFile(url, dst);
      const s = sizeOf(dst);
      ix[k] = { p: dst, s, t: Date.now() };
      results[url] = `file://${dst.replace(/\\/g, "/")}`;
    } catch {
      results[url] = url; // fallback
    }
  }
  await evictIfNeeded(ix);
  saveIndex(ix);
  return results;
});

/* ──────────────────────────────────────────────────────────────
   electron-store (dynamic import) - same as your code
────────────────────────────────────────────────────────────── */

type StoreInstance<T extends Record<string, unknown>> = {
  get<K extends keyof T & string>(key: K): T[K] | undefined;
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  clear(): void;
  readonly store: T;
};

async function getStore(): Promise<StoreInstance<DeviceState>> {
  const mod = await import("electron-store");
  const Store = mod.default as new <X extends Record<string, unknown>>(opts?: {
    name?: string;
  }) => unknown;
  return new Store<DeviceState>({
    name: "device",
  }) as StoreInstance<DeviceState>;
}

let win: BrowserWindow | null = null;
const isDev = !app.isPackaged;
function registerAppShortcuts(isDev: boolean) {
  try {
    // -------------------
    // Quit / Close
    // -------------------
    globalShortcut.register("CommandOrControl+Q", () => {
      log.info("Shortcut: Quit (Ctrl/Cmd+Q)");
      app.quit();
    });

    globalShortcut.register("CommandOrControl+Shift+Q", () => {
      log.info("Shortcut: Quit (Ctrl/Cmd+Shift+Q)");
      app.quit();
    });

    // -------------------
    // Reload / Force Reload
    // -------------------
    globalShortcut.register("CommandOrControl+R", () => {
      if (!win || win.isDestroyed()) return;
      log.info("Shortcut: Reload (Ctrl/Cmd+R)");
      win.webContents.reload();
    });

    globalShortcut.register("CommandOrControl+Shift+R", () => {
      if (!win || win.isDestroyed()) return;
      log.info("Shortcut: Force Reload (Ctrl/Cmd+Shift+R)");
      // ignore cache + reload
      win.webContents.reloadIgnoringCache();
    });

    // Optional: F5 / Ctrl+F5 (common on Windows)
    globalShortcut.register("F5", () => {
      if (!win || win.isDestroyed()) return;
      log.info("Shortcut: Reload (F5)");
      win.webContents.reload();
    });

    globalShortcut.register("CommandOrControl+F5", () => {
      if (!win || win.isDestroyed()) return;
      log.info("Shortcut: Force Reload (Ctrl+F5)");
      win.webContents.reloadIgnoringCache();
    });

    log.info("App shortcuts registered");
  } catch (e) {
    log.error("Failed to register shortcuts", e);
  }
}

function unregisterAppShortcuts() {
  try {
    globalShortcut.unregisterAll();
    log.info("App shortcuts unregistered");
  } catch {}
}

/* ──────────────────────────────────────────────────────────────
   ✅ NEW: Keep Awake (prevent sleep)
────────────────────────────────────────────────────────────── */

let psbId: number | null = null;

function startKeepAwake() {
  try {
    if (psbId != null && powerSaveBlocker.isStarted(psbId)) return;
    // prevent-display-sleep: prevents display sleep (and usually system sleep)
    psbId = powerSaveBlocker.start("prevent-display-sleep");
    log.info("powerSaveBlocker started", psbId);
  } catch (e) {
    log.error("powerSaveBlocker start error", e);
  }
}

function stopKeepAwake() {
  try {
    if (psbId != null && powerSaveBlocker.isStarted(psbId)) {
      powerSaveBlocker.stop(psbId);
      log.info("powerSaveBlocker stopped", psbId);
    }
  } catch {}
  psbId = null;
}

/* ──────────────────────────────────────────────────────────────
   ✅ NEW: Auto Launch on OS start (Windows/macOS)
────────────────────────────────────────────────────────────── */

function setupAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      // openAsHidden: true, // enable if you want hidden start
    });
    log.info("Auto-launch enabled");
  } catch (e) {
    log.error("Auto-launch setup error", e);
  }
}

function sixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function ensureCode() {
  const store = await getStore();
  if (!store.get("code")) store.set("code", sixDigitCode());
}

/* ──────────────────────────────────────────────────────────────
   ✅ Auto Update setup (electron-updater)
────────────────────────────────────────────────────────────── */

function setupAutoUpdate() {
  // logger
  log.transports.file.level = "info";
  autoUpdater.logger = log;

  // settings
  autoUpdater.autoDownload = true;

  const send = (payload: any) => {
    try {
      win?.webContents.send("updater:event", payload);
    } catch {}
  };

  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", (info) =>
    send({ type: "available", info })
  );
  autoUpdater.on("update-not-available", (info) => send({ type: "none", info }));
  autoUpdater.on("download-progress", (p) =>
    send({
      type: "progress",
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  );
  autoUpdater.on("update-downloaded", (info) =>
    send({ type: "downloaded", info })
  );
  autoUpdater.on("error", (err) =>
    send({ type: "error", message: err?.message || String(err) })
  );

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) return { ok: false, reason: "not_packaged" };
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, info: r?.updateInfo };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("updater:install", async () => {
    if (!app.isPackaged) return { ok: false, reason: "not_packaged" };
    try {
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   ✅ Window
   - NEW: Fullscreen on open
   - NEW: Hide menu + disable devtools in build
   - Keep devtools in dev
────────────────────────────────────────────────────────────── */

async function createWindow() {
  await ensureCode();

  // ✅ NEW: enable auto-launch + keep-awake
  setupAutoLaunch();
  startKeepAwake();

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: path.join(process.cwd(), "src/assets/IgaunaIcon.ico"),

    // ✅ NEW: Fullscreen on open
    fullscreen: true,

    // ✅ NEW: Hide menu bar
    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,

      // ✅ NEW: In build: block opening DevTools
      devTools: isDev,
    },
  });

  // ✅ NEW: Remove menu in build only
  if (!isDev) {
    win.removeMenu();
  }

  // ✅ NEW: Force fullscreen after ready (some Windows need this)
  win.once("ready-to-show", () => {
    try {
      win?.setFullScreen(true);
    } catch {}
  });

  // ✅ NEW: Block DevTools shortcuts in build (F12 / Ctrl+Shift+I)
  win.webContents.on("before-input-event", (event, input) => {
    if (isDev) return;

    const key = (input.key || "").toLowerCase();
    const isF12 = key === "f12";
    const isCtrlShiftI = input.control && input.shift && key === "i";

    if (isF12 || isCtrlShiftI) {
      event.preventDefault();
    }
  });

  if (isDev && process.env.ELECTRON_START_URL) {
    await win.loadURL(process.env.ELECTRON_START_URL);
    // ✅ Dev only (optional):
    // win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  // ✅ Start auto updater AFTER window is ready
  if (!isDev) {
    setupAutoUpdate();
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 4000);
  }

  win.on("closed", () => (win = null));
}

app.whenReady().then(async () => {
  startMediaProxy();
  registerAppShortcuts(isDev);
  await createWindow();
});

// ✅ NEW: stop keep-awake on quit
app.on("before-quit", () => {
  unregisterAppShortcuts();
  stopKeepAwake();
  stopMediaProxy();

});

app.on("window-all-closed", () => {
  stopKeepAwake();
  stopMediaProxy();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ──────────────────────────────────────────────────────────────
   IPC: device state
────────────────────────────────────────────────────────────── */

ipcMain.handle("signage:getDeviceState", async () => {
  const store = await getStore();
  const { code, screenId } = store.store;
  return { code, screenId } as DeviceState;
});

ipcMain.handle("signage:saveScreenId", async (_e, screenId: string) => {
  const store = await getStore();
  store.set("screenId", screenId);
  return { ok: true };
});

ipcMain.handle("signage:resetDevice", async () => {
  const store = await getStore();
  store.clear();
  return { ok: true };
});

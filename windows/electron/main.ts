import { app, BrowserWindow, ipcMain, powerSaveBlocker, globalShortcut, safeStorage, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
const streamPipeline = promisify(pipeline);

import log from "electron-log";

const MEDIA_DIR = path.join(app.getPath("userData"), "media-cache");
const INDEX_FILE = path.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MEDIA_PROXY_PORT = Number(process.env.MEDIA_PROXY_PORT || 17654);
const MEDIA_PROXY_HOST = "127.0.0.1";
let mediaProxyAllowedHost: string | null = null;
let mediaProxyAllowedPort = 8000;
const MEDIA_PROXY_EXPOSED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

function normalizeServerAddress(address: string) {
  return String(address || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .trim();
}

function isValidServerHost(hostname: string) {
  const host = hostname.trim().toLowerCase();
  if (!host || host.length > 253 || host === "localhost") return false;
  if (net.isIP(host)) return true;
  return host.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}

function pingServerAddress(address: string, port: number): Promise<boolean> {
  const host = normalizeServerAddress(address);
  if (!isValidServerHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(5000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

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

function isConfiguredMediaHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === mediaProxyAllowedHost && host !== "localhost" && host !== "127.0.0.1";
}

function parseAllowedMediaUrl(value: string | null) {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    if (!target.pathname.includes("/storage/")) return null;
    if (!isConfiguredMediaHost(target.hostname)) return null;
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    if (port !== mediaProxyAllowedPort) return null;
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
        redirect: "error",
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
  linked?: boolean;
  [key: string]: unknown;
}

function encryptAuthToken(token: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this device");
  }
  return safeStorage.encryptString(token).toString("base64");
}

function decryptAuthToken(value: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this device");
  }
  return safeStorage.decryptString(Buffer.from(value, "base64"));
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

ipcMain.handle("ping-server", async (_evt, address: string, port: number) => {
  return pingServerAddress(address, port);
});

ipcMain.handle("media-proxy:configure-server", async (evt, host: string, port: number) => {
  assertTrustedRenderer(evt);
  const normalizedHost = normalizeServerAddress(host).toLowerCase();
  if (!isValidServerHost(normalizedHost) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("Invalid media server configuration");
  }
  mediaProxyAllowedHost = normalizedHost;
  mediaProxyAllowedPort = port;
  return { ok: true };
});

/* ──────────────────────────────────────────────────────────────
   electron-store (dynamic import) - same as your code
────────────────────────────────────────────────────────────── */

type StoreInstance<T extends Record<string, unknown>> = {
  get<K extends keyof T & string>(key: K): T[K] | undefined;
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  delete<K extends keyof T & string>(key: K): void;
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
function assertTrustedRenderer(event: { senderFrame?: { url: string } | null }) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) throw new Error("Untrusted IPC sender");
  if (frameUrl.startsWith("file://")) {
    const actual = path.resolve(fileURLToPath(frameUrl));
    const expected = path.resolve(app.getAppPath(), "dist", "index.html");
    if (actual === expected) return;
  } else if (isDev && process.env.ELECTRON_START_URL) {
    const senderOrigin = new URL(frameUrl).origin;
    const configuredOrigin = new URL(process.env.ELECTRON_START_URL).origin;
    if (senderOrigin === configuredOrigin) return;
  }
  throw new Error("Untrusted IPC sender");
}

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
────────────────────────────────────────────────────────────── */

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
  win.on("closed", () => (win = null));
}

function setupPowerMonitor() {
  try {
    powerMonitor.on("resume", () => {
      log.info("[powerMonitor] System resumed from sleep/suspend");
      if (win && !win.isDestroyed()) {
        win.webContents.send("system:power-resume");
      }
    });
    powerMonitor.on("suspend", () => {
      log.info("[powerMonitor] System suspended");
      if (win && !win.isDestroyed()) {
        win.webContents.send("system:power-suspend");
      }
    });
  } catch (err) {
    log.error("[powerMonitor] Failed to setup powerMonitor listeners", err);
  }
}

app.whenReady().then(async () => {
  startMediaProxy();
  registerAppShortcuts(isDev);
  setupPowerMonitor();
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

ipcMain.handle("signage:getDeviceState", async (evt) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  const { code, screenId, linked } = store.store;
  return { code, screenId, linked: typeof linked === "boolean" ? linked : undefined } as DeviceState;
});

ipcMain.handle("signage:saveScreenId", async (evt, screenId: string) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  store.set("screenId", screenId);
  return { ok: true };
});

ipcMain.handle("signage:setLinked", async (evt, linked: boolean) => {
  assertTrustedRenderer(evt);
  if (typeof linked !== "boolean") throw new TypeError("linked must be a boolean");
  const store = await getStore();
  store.set("linked", linked);
  return { ok: true };
});

ipcMain.handle("signage:getAuthToken", async (evt) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  const encrypted = store.get("authTokenEncrypted");
  if (!encrypted) return undefined;
  if (typeof encrypted !== "string") {
    throw new Error("Stored credential has an invalid format");
  }
  return decryptAuthToken(encrypted);
});

ipcMain.handle("signage:saveAuthToken", async (evt, token: string) => {
  assertTrustedRenderer(evt);
  if (typeof token !== "string" || token.length === 0 || token.length > 8192) {
    throw new TypeError("Invalid authentication token");
  }
  const store = await getStore();
  store.set("authTokenEncrypted", encryptAuthToken(token));
  return { ok: true };
});

ipcMain.handle("signage:clearAuthToken", async (evt) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  store.delete("authTokenEncrypted");
  return { ok: true };
});

ipcMain.handle("signage:resetDevice", async (evt) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  store.clear();
  return { ok: true };
});

ipcMain.handle("signage:getClockCalibration", async (evt) => {
  assertTrustedRenderer(evt);
  const store = await getStore();
  const raw = store.get("clockCalibration" as any);
  if (!raw || typeof raw !== "object") return null;
  return raw;
});

ipcMain.handle("signage:saveClockCalibration", async (evt, calibration) => {
  assertTrustedRenderer(evt);
  if (!calibration || typeof calibration !== "object") {
    throw new TypeError("Invalid clock calibration payload");
  }
  const store = await getStore();
  store.set("clockCalibration" as any, calibration);
  return { ok: true };
});


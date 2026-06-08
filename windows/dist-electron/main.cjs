"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_crypto_1 = require("node:crypto");
const node_stream_1 = require("node:stream");
const node_util_1 = require("node:util");
const streamPipeline = (0, node_util_1.promisify)(node_stream_1.pipeline);
const electron_log_1 = __importDefault(require("electron-log"));
const MEDIA_DIR = node_path_1.default.join(electron_1.app.getPath("userData"), "media-cache");
const INDEX_FILE = node_path_1.default.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MEDIA_PROXY_PORT = Number(process.env.MEDIA_PROXY_PORT || 17654);
const MEDIA_PROXY_HOST = "127.0.0.1";
const MEDIA_PROXY_ALLOWED_HOSTS = new Set([
    "192.168.10.16",
    process.env.VITE_REVERB_HOST,
    process.env.MEDIA_SERVER_HOST,
    process.env.SERVER_HOST,
]
    .filter(Boolean)
    .map((host) => String(host).trim().toLowerCase()));
const MEDIA_PROXY_EXPOSED_HEADERS = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
];
let mediaProxyServer = null;
function addMediaProxyCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, Origin");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");
}
function isPrivateLanHost(hostname) {
    const host = hostname.toLowerCase();
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    return MEDIA_PROXY_ALLOWED_HOSTS.has(host);
}
function parseAllowedMediaUrl(value) {
    if (!value)
        return null;
    try {
        const target = new URL(value);
        if (target.protocol !== "http:" && target.protocol !== "https:")
            return null;
        if (!target.pathname.includes("/storage/"))
            return null;
        if (!isPrivateLanHost(target.hostname))
            return null;
        return target;
    }
    catch {
        return null;
    }
}
function copyMediaHeaders(remote, res) {
    for (const headerName of MEDIA_PROXY_EXPOSED_HEADERS) {
        const value = remote.headers.get(headerName);
        if (value)
            res.setHeader(headerName, value);
    }
    if (!remote.headers.get("accept-ranges")) {
        res.setHeader("Accept-Ranges", "bytes");
    }
}
function startMediaProxy() {
    if (mediaProxyServer)
        return;
    mediaProxyServer = node_http_1.default.createServer(async (req, res) => {
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
            const headers = {};
            const range = req.headers.range;
            if (range)
                headers.Range = String(range);
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
            await streamPipeline(remote.body, res);
        }
        catch (e) {
            if (abort.signal.aborted || res.headersSent)
                return;
            res.writeHead(502).end(e?.message || "Media proxy error");
        }
    });
    mediaProxyServer.on("error", (e) => {
        electron_log_1.default.error("Media proxy error", e);
    });
    mediaProxyServer.listen(MEDIA_PROXY_PORT, MEDIA_PROXY_HOST, () => {
        electron_log_1.default.info(`Media proxy listening on http://${MEDIA_PROXY_HOST}:${MEDIA_PROXY_PORT}`);
    });
}
function stopMediaProxy() {
    if (!mediaProxyServer)
        return;
    mediaProxyServer.close();
    mediaProxyServer = null;
}
function ensureDir() {
    if (!node_fs_1.default.existsSync(MEDIA_DIR))
        node_fs_1.default.mkdirSync(MEDIA_DIR, { recursive: true });
}
function loadIndex() {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(INDEX_FILE, "utf8"));
    }
    catch {
        return {};
    }
}
function saveIndex(ix) {
    node_fs_1.default.writeFileSync(INDEX_FILE, JSON.stringify(ix), "utf8");
}
function keyFor(url) {
    return (0, node_crypto_1.createHash)("sha1").update(url).digest("hex");
}
function sizeOf(file) {
    try {
        return node_fs_1.default.statSync(file).size;
    }
    catch {
        return 0;
    }
}
function totalSize(ix) {
    return Object.values(ix).reduce((a, r) => a + (r.s || 0), 0);
}
async function evictIfNeeded(ix) {
    let sz = totalSize(ix);
    if (sz <= MAX_BYTES)
        return;
    const entries = Object.entries(ix).sort((a, b) => a[1].t - b[1].t); // LRU
    for (const [k, rec] of entries) {
        try {
            node_fs_1.default.unlinkSync(rec.p);
        }
        catch { }
        delete ix[k];
        sz = totalSize(ix);
        if (sz <= MAX_BYTES)
            break;
    }
    saveIndex(ix);
}
async function downloadToFile(url, dst) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const file = node_fs_1.default.createWriteStream(dst);
    await streamPipeline(res.body, file);
}
/* ──────────────────────────────────────────────────────────────
   IPC: media cache
────────────────────────────────────────────────────────────── */
electron_1.ipcMain.handle("media-cache:map", async (_evt, urls) => {
    ensureDir();
    const ix = loadIndex();
    const results = {};
    for (const url of urls) {
        const k = keyFor(url);
        const rec = ix[k];
        if (rec && node_fs_1.default.existsSync(rec.p)) {
            rec.t = Date.now();
            results[url] = `file://${rec.p.replace(/\\/g, "/")}`;
            continue;
        }
        const ext = node_path_1.default.extname(new URL(url).pathname) || "";
        const dst = node_path_1.default.join(MEDIA_DIR, `${k}${ext}`);
        try {
            await downloadToFile(url, dst);
            const s = sizeOf(dst);
            ix[k] = { p: dst, s, t: Date.now() };
            results[url] = `file://${dst.replace(/\\/g, "/")}`;
        }
        catch {
            results[url] = url; // fallback
        }
    }
    await evictIfNeeded(ix);
    saveIndex(ix);
    return results;
});
async function getStore() {
    const mod = await Promise.resolve().then(() => __importStar(require("electron-store")));
    const Store = mod.default;
    return new Store({
        name: "device",
    });
}
let win = null;
const isDev = !electron_1.app.isPackaged;
function registerAppShortcuts(isDev) {
    try {
        // -------------------
        // Quit / Close
        // -------------------
        electron_1.globalShortcut.register("CommandOrControl+Q", () => {
            electron_log_1.default.info("Shortcut: Quit (Ctrl/Cmd+Q)");
            electron_1.app.quit();
        });
        electron_1.globalShortcut.register("CommandOrControl+Shift+Q", () => {
            electron_log_1.default.info("Shortcut: Quit (Ctrl/Cmd+Shift+Q)");
            electron_1.app.quit();
        });
        // -------------------
        // Reload / Force Reload
        // -------------------
        electron_1.globalShortcut.register("CommandOrControl+R", () => {
            if (!win || win.isDestroyed())
                return;
            electron_log_1.default.info("Shortcut: Reload (Ctrl/Cmd+R)");
            win.webContents.reload();
        });
        electron_1.globalShortcut.register("CommandOrControl+Shift+R", () => {
            if (!win || win.isDestroyed())
                return;
            electron_log_1.default.info("Shortcut: Force Reload (Ctrl/Cmd+Shift+R)");
            // ignore cache + reload
            win.webContents.reloadIgnoringCache();
        });
        // Optional: F5 / Ctrl+F5 (common on Windows)
        electron_1.globalShortcut.register("F5", () => {
            if (!win || win.isDestroyed())
                return;
            electron_log_1.default.info("Shortcut: Reload (F5)");
            win.webContents.reload();
        });
        electron_1.globalShortcut.register("CommandOrControl+F5", () => {
            if (!win || win.isDestroyed())
                return;
            electron_log_1.default.info("Shortcut: Force Reload (Ctrl+F5)");
            win.webContents.reloadIgnoringCache();
        });
        electron_log_1.default.info("App shortcuts registered");
    }
    catch (e) {
        electron_log_1.default.error("Failed to register shortcuts", e);
    }
}
function unregisterAppShortcuts() {
    try {
        electron_1.globalShortcut.unregisterAll();
        electron_log_1.default.info("App shortcuts unregistered");
    }
    catch { }
}
/* ──────────────────────────────────────────────────────────────
   ✅ NEW: Keep Awake (prevent sleep)
────────────────────────────────────────────────────────────── */
let psbId = null;
function startKeepAwake() {
    try {
        if (psbId != null && electron_1.powerSaveBlocker.isStarted(psbId))
            return;
        // prevent-display-sleep: prevents display sleep (and usually system sleep)
        psbId = electron_1.powerSaveBlocker.start("prevent-display-sleep");
        electron_log_1.default.info("powerSaveBlocker started", psbId);
    }
    catch (e) {
        electron_log_1.default.error("powerSaveBlocker start error", e);
    }
}
function stopKeepAwake() {
    try {
        if (psbId != null && electron_1.powerSaveBlocker.isStarted(psbId)) {
            electron_1.powerSaveBlocker.stop(psbId);
            electron_log_1.default.info("powerSaveBlocker stopped", psbId);
        }
    }
    catch { }
    psbId = null;
}
/* ──────────────────────────────────────────────────────────────
   ✅ NEW: Auto Launch on OS start (Windows/macOS)
────────────────────────────────────────────────────────────── */
function setupAutoLaunch() {
    try {
        electron_1.app.setLoginItemSettings({
            openAtLogin: true,
            // openAsHidden: true, // enable if you want hidden start
        });
        electron_log_1.default.info("Auto-launch enabled");
    }
    catch (e) {
        electron_log_1.default.error("Auto-launch setup error", e);
    }
}
function sixDigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
async function ensureCode() {
    const store = await getStore();
    if (!store.get("code"))
        store.set("code", sixDigitCode());
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
    win = new electron_1.BrowserWindow({
        width: 1000,
        height: 700,
        icon: node_path_1.default.join(process.cwd(), "src/assets/IgaunaIcon.ico"),
        // ✅ NEW: Fullscreen on open
        fullscreen: true,
        // ✅ NEW: Hide menu bar
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.cjs"),
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
        }
        catch { }
    });
    // ✅ NEW: Block DevTools shortcuts in build (F12 / Ctrl+Shift+I)
    win.webContents.on("before-input-event", (event, input) => {
        if (isDev)
            return;
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
    }
    else {
        await win.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), "dist", "index.html"));
    }
    // ✅ Start auto updater AFTER window is ready
    win.on("closed", () => (win = null));
}
electron_1.app.whenReady().then(async () => {
    startMediaProxy();
    registerAppShortcuts(isDev);
    await createWindow();
});
// ✅ NEW: stop keep-awake on quit
electron_1.app.on("before-quit", () => {
    unregisterAppShortcuts();
    stopKeepAwake();
    stopMediaProxy();
});
electron_1.app.on("window-all-closed", () => {
    stopKeepAwake();
    stopMediaProxy();
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
/* ──────────────────────────────────────────────────────────────
   IPC: device state
────────────────────────────────────────────────────────────── */
electron_1.ipcMain.handle("signage:getDeviceState", async () => {
    const store = await getStore();
    const { code, screenId } = store.store;
    return { code, screenId };
});
electron_1.ipcMain.handle("signage:saveScreenId", async (_e, screenId) => {
    const store = await getStore();
    store.set("screenId", screenId);
    return { ok: true };
});
electron_1.ipcMain.handle("signage:resetDevice", async () => {
    const store = await getStore();
    store.clear();
    return { ok: true };
});

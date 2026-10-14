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
const mediaStorageEngine_1 = require("./mediaStorage/mediaStorageEngine");
const mediaDownloadQueue_1 = require("./mediaStorage/mediaDownloadQueue");
const nodeFileSystemAdapter_1 = require("./mediaStorage/nodeFileSystemAdapter");
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_net_1 = __importDefault(require("node:net"));
const node_crypto_1 = require("node:crypto");
const node_stream_1 = require("node:stream");
const node_util_1 = require("node:util");
const streamPipeline = (0, node_util_1.promisify)(node_stream_1.pipeline);
const electron_log_1 = __importDefault(require("electron-log"));
const MEDIA_DIR = node_path_1.default.join(electron_1.app.getPath("userData"), "media-cache");
const mediaStorage = new mediaStorageEngine_1.MediaStorageEngine({
    baseDir: MEDIA_DIR,
    quotaBytes: 2 * 1024 * 1024 * 1024,
    fs: new nodeFileSystemAdapter_1.NodeFileSystemAdapter(),
});
const mediaDownloadQueue = new mediaDownloadQueue_1.MediaDownloadQueue(mediaStorage, { concurrency: 1 });
mediaStorage.setDownloadQueue(mediaDownloadQueue);
const INDEX_FILE = node_path_1.default.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MEDIA_PROXY_PORT = Number(process.env.MEDIA_PROXY_PORT || 17654);
const MEDIA_PROXY_HOST = "127.0.0.1";
let mediaProxyAllowedHost = null;
let mediaProxyAllowedPort = 8000;
const MEDIA_PROXY_EXPOSED_HEADERS = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
];
function normalizeServerAddress(address) {
    return String(address || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .trim();
}
function isValidServerHost(hostname) {
    const host = hostname.trim().toLowerCase();
    if (!host || host.length > 253 || host === "localhost")
        return false;
    if (node_net_1.default.isIP(host))
        return true;
    return host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function pingServerAddress(address, port) {
    const host = normalizeServerAddress(address);
    if (!isValidServerHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const socket = node_net_1.default.createConnection({ host, port });
        let settled = false;
        const finish = (ok) => {
            if (settled)
                return;
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
let mediaProxyServer = null;
function addMediaProxyCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, Origin");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.setHeader("Accept-Ranges", "bytes");
}
function isConfiguredMediaHost(hostname) {
    const host = hostname.toLowerCase();
    return host === mediaProxyAllowedHost && host !== "localhost" && host !== "127.0.0.1";
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
        if (!isConfiguredMediaHost(target.hostname))
            return null;
        const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
        if (port !== mediaProxyAllowedPort)
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
        // Route: Chromium-compatible local media delivery with HTTP Range (RFC 7233)
        if (requestUrl.pathname === "/local-media") {
            if (req.method === "OPTIONS") {
                res.writeHead(204).end();
                return;
            }
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.writeHead(405).end("Method not allowed");
                return;
            }
            const assetKey = requestUrl.searchParams.get("key");
            const origUrl = requestUrl.searchParams.get("orig") || requestUrl.searchParams.get("url");
            if (!assetKey && !origUrl) {
                res.writeHead(400).end("Missing asset key or URL parameter");
                return;
            }
            const lookupKey = assetKey || origUrl;
            const record = mediaStorage.getAsset(lookupKey);
            if (!record || record.status !== "completed" || !record.localPath) {
                res.writeHead(404).end("Media asset not found or not completed in local cache");
                return;
            }
            // Security restriction: strictly enforce that local file is inside MEDIA_DIR
            const resolvedPath = node_path_1.default.resolve(record.localPath);
            const resolvedMediaDir = node_path_1.default.resolve(MEDIA_DIR);
            if (!resolvedPath.startsWith(resolvedMediaDir)) {
                electron_log_1.default.warn("Blocked attempted path traversal in local media proxy:", resolvedPath);
                res.writeHead(403).end("Forbidden: Access outside media cache directory");
                return;
            }
            if (!node_fs_1.default.existsSync(resolvedPath)) {
                res.writeHead(404).end("Local media file missing on disk");
                return;
            }
            const stat = node_fs_1.default.statSync(resolvedPath);
            const totalSize = stat.size;
            const ext = node_path_1.default.extname(resolvedPath).toLowerCase();
            const mimeTypes = {
                ".mp4": "video/mp4",
                ".webm": "video/webm",
                ".mov": "video/quicktime",
                ".mkv": "video/x-matroska",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".svg": "image/svg+xml",
                ".mp3": "audio/mpeg",
                ".wav": "audio/wav",
            };
            const contentType = mimeTypes[ext] || "application/octet-stream";
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            const rangeHeader = req.headers.range;
            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
                if (!match) {
                    res.setHeader("Content-Range", `bytes */${totalSize}`);
                    res.writeHead(416).end("Requested Range Not Satisfiable");
                    return;
                }
                const rawStart = match[1];
                const rawEnd = match[2];
                let start = 0;
                let end = totalSize - 1;
                if (rawStart && rawEnd) {
                    start = parseInt(rawStart, 10);
                    end = parseInt(rawEnd, 10);
                }
                else if (rawStart) {
                    start = parseInt(rawStart, 10);
                    end = totalSize - 1;
                }
                else if (rawEnd) {
                    start = totalSize - parseInt(rawEnd, 10);
                    end = totalSize - 1;
                }
                if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= totalSize) {
                    res.setHeader("Content-Range", `bytes */${totalSize}`);
                    res.writeHead(416).end("Requested Range Not Satisfiable");
                    return;
                }
                const contentLength = end - start + 1;
                res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
                res.setHeader("Content-Length", String(contentLength));
                res.writeHead(206);
                if (req.method === "HEAD") {
                    res.end();
                    return;
                }
                const releaseLease = mediaStorage.acquireReaderLease(record.assetKey);
                let leaseReleased = false;
                const safeRelease = () => {
                    if (!leaseReleased) {
                        leaseReleased = true;
                        releaseLease();
                    }
                };
                const stream = node_fs_1.default.createReadStream(resolvedPath, { start, end });
                stream.pipe(res);
                req.on("close", () => {
                    stream.destroy();
                    safeRelease();
                });
                res.on("finish", safeRelease);
            }
            else {
                res.setHeader("Content-Length", String(totalSize));
                res.writeHead(200);
                if (req.method === "HEAD") {
                    res.end();
                    return;
                }
                const releaseLease = mediaStorage.acquireReaderLease(record.assetKey);
                let leaseReleased = false;
                const safeRelease = () => {
                    if (!leaseReleased) {
                        leaseReleased = true;
                        releaseLease();
                    }
                };
                const stream = node_fs_1.default.createReadStream(resolvedPath);
                stream.pipe(res);
                req.on("close", () => {
                    stream.destroy();
                    safeRelease();
                });
                res.on("finish", safeRelease);
            }
            return;
        }
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
                redirect: "error",
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
function encryptAuthToken(token) {
    if (!electron_1.safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure credential storage is unavailable on this device");
    }
    return electron_1.safeStorage.encryptString(token).toString("base64");
}
function decryptAuthToken(value) {
    if (!electron_1.safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure credential storage is unavailable on this device");
    }
    return electron_1.safeStorage.decryptString(Buffer.from(value, "base64"));
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
    return mediaStorage.mapUrls(urls);
});
electron_1.ipcMain.handle("media-cache:getManifest", async () => {
    return mediaStorage.getManifest();
});
electron_1.ipcMain.handle("media-cache:getAsset", async (_evt, urlOrKey) => {
    return mediaStorage.getAsset(urlOrKey);
});
electron_1.ipcMain.handle("media-cache:setActiveAssets", async (_evt, urls) => {
    await mediaStorage.setActiveAssets(urls);
    return { ok: true };
});
electron_1.ipcMain.handle("media-cache:setProtectedAssets", async (_evt, source, urls) => {
    await mediaStorage.setProtectedAssets(source, urls);
    return { ok: true };
});
electron_1.ipcMain.handle("media-cache:acquireReaderLease", async (_evt, urlOrKey) => {
    mediaStorage.acquireReaderLease(urlOrKey);
    return { ok: true };
});
electron_1.ipcMain.handle("media-cache:releaseReaderLease", async (_evt, urlOrKey) => {
    mediaStorage.releaseReaderLease(urlOrKey);
    return { ok: true };
});
electron_1.ipcMain.handle("media-cache:cleanup", async (_evt, options) => {
    return mediaStorage.performCleanup(options);
});
electron_1.ipcMain.handle("media-cache:getCleanupDiagnostics", async () => {
    return mediaStorage.getCleanupDiagnostics();
});
electron_1.ipcMain.handle("media-cache:reconcile", async () => {
    return mediaStorage.reconcileStartup();
});
electron_1.ipcMain.handle("media-cache:setQuota", async (_evt, bytes) => {
    const result = await mediaStorage.setQuota(bytes);
    return { ok: true, ...result };
});
electron_1.ipcMain.handle("media-cache:getStats", async () => {
    return mediaStorage.getStorageStats();
});
electron_1.ipcMain.handle("media-cache:evict", async () => {
    return mediaStorage.evictIfNeeded();
});
/* ── IPC: background media download queue ── */
electron_1.ipcMain.handle("media-queue:enqueue", async (_evt, url, options) => {
    return mediaDownloadQueue.enqueue(url, options);
});
electron_1.ipcMain.handle("media-queue:enqueuePlaylist", async (_evt, playlist, basePriority) => {
    return mediaDownloadQueue.enqueuePlaylistMedia(playlist, basePriority);
});
electron_1.ipcMain.handle("media-queue:cancel", async (_evt, urlOrKey) => {
    const ok = mediaDownloadQueue.cancelTask(urlOrKey) || mediaDownloadQueue.cancelUrl(urlOrKey);
    return { ok };
});
electron_1.ipcMain.handle("media-queue:cancelAll", async () => {
    mediaDownloadQueue.cancelAll();
    return { ok: true };
});
electron_1.ipcMain.handle("media-queue:pause", async () => {
    mediaDownloadQueue.pause();
    return { ok: true };
});
electron_1.ipcMain.handle("media-queue:resume", async () => {
    mediaDownloadQueue.resume();
    return { ok: true };
});
electron_1.ipcMain.handle("media-queue:getStats", async () => {
    return mediaDownloadQueue.getStats();
});
electron_1.ipcMain.handle("media-cache:purgeCorrupt", async () => {
    return mediaStorage.purgeCorruptOrMissing();
});
electron_1.ipcMain.handle("ping-server", async (_evt, address, port) => {
    return pingServerAddress(address, port);
});
electron_1.ipcMain.handle("media-proxy:configure-server", async (evt, host, port) => {
    assertTrustedRenderer(evt);
    const normalizedHost = normalizeServerAddress(host).toLowerCase();
    if (!isValidServerHost(normalizedHost) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new TypeError("Invalid media server configuration");
    }
    mediaProxyAllowedHost = normalizedHost;
    mediaProxyAllowedPort = port;
    return { ok: true };
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
function assertTrustedRenderer(event) {
    const frameUrl = event.senderFrame?.url;
    if (!frameUrl)
        throw new Error("Untrusted IPC sender");
    if (frameUrl.startsWith("file://")) {
        const actual = node_path_1.default.resolve((0, node_url_1.fileURLToPath)(frameUrl));
        const expected = node_path_1.default.resolve(electron_1.app.getAppPath(), "dist", "index.html");
        if (actual === expected)
            return;
    }
    else if (isDev && process.env.ELECTRON_START_URL) {
        const senderOrigin = new URL(frameUrl).origin;
        const configuredOrigin = new URL(process.env.ELECTRON_START_URL).origin;
        if (senderOrigin === configuredOrigin)
            return;
    }
    throw new Error("Untrusted IPC sender");
}
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
function setupPowerMonitor() {
    try {
        electron_1.powerMonitor.on("resume", () => {
            electron_log_1.default.info("[powerMonitor] System resumed from sleep/suspend");
            if (win && !win.isDestroyed()) {
                win.webContents.send("system:power-resume");
            }
        });
        electron_1.powerMonitor.on("suspend", () => {
            electron_log_1.default.info("[powerMonitor] System suspended");
            if (win && !win.isDestroyed()) {
                win.webContents.send("system:power-suspend");
            }
        });
    }
    catch (err) {
        electron_log_1.default.error("[powerMonitor] Failed to setup powerMonitor listeners", err);
    }
}
electron_1.app.whenReady().then(async () => {
    startMediaProxy();
    registerAppShortcuts(isDev);
    setupPowerMonitor();
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
electron_1.ipcMain.handle("signage:getDeviceState", async (evt) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    const { code, screenId, linked } = store.store;
    return { code, screenId, linked: typeof linked === "boolean" ? linked : undefined };
});
electron_1.ipcMain.handle("signage:saveScreenId", async (evt, screenId) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    store.set("screenId", screenId);
    return { ok: true };
});
electron_1.ipcMain.handle("signage:setLinked", async (evt, linked) => {
    assertTrustedRenderer(evt);
    if (typeof linked !== "boolean")
        throw new TypeError("linked must be a boolean");
    const store = await getStore();
    store.set("linked", linked);
    return { ok: true };
});
electron_1.ipcMain.handle("signage:getAuthToken", async (evt) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    const encrypted = store.get("authTokenEncrypted");
    if (!encrypted)
        return undefined;
    if (typeof encrypted !== "string") {
        throw new Error("Stored credential has an invalid format");
    }
    return decryptAuthToken(encrypted);
});
electron_1.ipcMain.handle("signage:saveAuthToken", async (evt, token) => {
    assertTrustedRenderer(evt);
    if (typeof token !== "string" || token.length === 0 || token.length > 8192) {
        throw new TypeError("Invalid authentication token");
    }
    const store = await getStore();
    store.set("authTokenEncrypted", encryptAuthToken(token));
    return { ok: true };
});
electron_1.ipcMain.handle("signage:clearAuthToken", async (evt) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    store.delete("authTokenEncrypted");
    return { ok: true };
});
electron_1.ipcMain.handle("signage:resetDevice", async (evt) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    store.clear();
    return { ok: true };
});
electron_1.ipcMain.handle("signage:getClockCalibration", async (evt) => {
    assertTrustedRenderer(evt);
    const store = await getStore();
    const raw = store.get("clockCalibration");
    if (!raw || typeof raw !== "object")
        return null;
    return raw;
});
electron_1.ipcMain.handle("signage:saveClockCalibration", async (evt, calibration) => {
    assertTrustedRenderer(evt);
    if (!calibration || typeof calibration !== "object") {
        throw new TypeError("Invalid clock calibration payload");
    }
    const store = await getStore();
    store.set("clockCalibration", calibration);
    return { ok: true };
});

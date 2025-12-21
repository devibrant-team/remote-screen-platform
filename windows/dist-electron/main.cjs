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
const node_crypto_1 = require("node:crypto");
const node_stream_1 = require("node:stream");
const node_util_1 = require("node:util");
const streamPipeline = (0, node_util_1.promisify)(node_stream_1.pipeline);
// ✅ Auto update
const electron_log_1 = __importDefault(require("electron-log"));
const electron_updater_1 = require("electron-updater");
const MEDIA_DIR = node_path_1.default.join(electron_1.app.getPath("userData"), "media-cache");
const INDEX_FILE = node_path_1.default.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
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
function sixDigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
async function ensureCode() {
    const store = await getStore();
    if (!store.get("code"))
        store.set("code", sixDigitCode());
}
/* ──────────────────────────────────────────────────────────────
   ✅ Auto Update setup (electron-updater)
────────────────────────────────────────────────────────────── */
function setupAutoUpdate() {
    // logger
    electron_log_1.default.transports.file.level = "info";
    electron_updater_1.autoUpdater.logger = electron_log_1.default;
    // settings
    electron_updater_1.autoUpdater.autoDownload = true;
    const send = (payload) => {
        try {
            win?.webContents.send("updater:event", payload);
        }
        catch { }
    };
    electron_updater_1.autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
    electron_updater_1.autoUpdater.on("update-available", (info) => send({ type: "available", info }));
    electron_updater_1.autoUpdater.on("update-not-available", (info) => send({ type: "none", info }));
    electron_updater_1.autoUpdater.on("download-progress", (p) => send({
        type: "progress",
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
    }));
    electron_updater_1.autoUpdater.on("update-downloaded", (info) => send({ type: "downloaded", info }));
    electron_updater_1.autoUpdater.on("error", (err) => send({ type: "error", message: err?.message || String(err) }));
    electron_1.ipcMain.handle("updater:check", async () => {
        if (!electron_1.app.isPackaged)
            return { ok: false, reason: "not_packaged" };
        try {
            const r = await electron_updater_1.autoUpdater.checkForUpdates();
            return { ok: true, info: r?.updateInfo };
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    });
    electron_1.ipcMain.handle("updater:install", async () => {
        if (!electron_1.app.isPackaged)
            return { ok: false, reason: "not_packaged" };
        try {
            electron_updater_1.autoUpdater.quitAndInstall(true, true);
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    });
}
/* ──────────────────────────────────────────────────────────────
   Window
────────────────────────────────────────────────────────────── */
async function createWindow() {
    await ensureCode();
    win = new electron_1.BrowserWindow({
        width: 1000,
        height: 700,
        icon: node_path_1.default.join(process.cwd(), "src/assets/IgaunaIcon.ico"),
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (isDev && process.env.ELECTRON_START_URL) {
        await win.loadURL(process.env.ELECTRON_START_URL);
    }
    else {
        await win.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), "dist", "index.html"));
    }
    // ✅ Start auto updater AFTER window is ready
    if (!isDev) {
        setupAutoUpdate();
        setTimeout(() => {
            electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
        }, 4000);
    }
    win.on("closed", () => (win = null));
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on("window-all-closed", () => {
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

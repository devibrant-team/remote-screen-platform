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
async function getStore() {
    const mod = await Promise.resolve().then(() => __importStar(require("electron-store")));
    const Store = mod.default;
    return new Store({ name: "device" });
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
async function createWindow() {
    await ensureCode();
    win = new electron_1.BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    if (isDev && process.env.ELECTRON_START_URL) {
        await win.loadURL(process.env.ELECTRON_START_URL);
    }
    else {
        await win.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), 'dist', 'index.html'));
    }
    win.on("closed", () => (win = null));
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on("window-all-closed", () => { if (process.platform !== "darwin")
    electron_1.app.quit(); });
electron_1.app.on("activate", () => { if (electron_1.BrowserWindow.getAllWindows().length === 0)
    createWindow(); });
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

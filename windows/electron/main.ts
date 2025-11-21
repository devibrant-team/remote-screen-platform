// electron/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import fs from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
const streamPipeline = promisify(pipeline);

const MEDIA_DIR = path.join(app.getPath("userData"), "media-cache");
const INDEX_FILE = path.join(MEDIA_DIR, "index.json");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

type IndexRec = { p: string; s: number; t: number };
type IndexMap = Record<string, IndexRec>;

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

function sixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function ensureCode() {
  const store = await getStore();
  if (!store.get("code")) store.set("code", sixDigitCode());
}

async function createWindow() {
  await ensureCode();
win = new BrowserWindow({
  width: 1000,
  height: 700,
  icon: path.join(process.cwd(), "src/assets/IgaunaIcon.ico"),
  webPreferences: {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
  },
});


  if (isDev && process.env.ELECTRON_START_URL) {
    await win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    await win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
  win.on("closed", () => (win = null));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

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

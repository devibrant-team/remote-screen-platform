// electron/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

export interface DeviceState {
  code?: string;
  screenId?: string;
  [key: string]: unknown;
}

type StoreInstance<T extends Record<string, unknown>> = {
  get<K extends keyof T & string>(key: K): T[K] | undefined;
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  clear(): void;
  readonly store: T;
};

async function getStore(): Promise<StoreInstance<DeviceState>> {
  const mod = await import("electron-store");
  const Store = mod.default as new <X extends Record<string, unknown>>(opts?: { name?: string }) => unknown;
  return new Store<DeviceState>({ name: "device" }) as StoreInstance<DeviceState>;
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.ELECTRON_START_URL) {
    await win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    await win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html')); 
  }
  win.on("closed", () => (win = null));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

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

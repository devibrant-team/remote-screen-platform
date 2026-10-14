// electron/preload.ts  (compiled to preload.cjs by your build step)
import { contextBridge, ipcRenderer } from "electron";

type DeviceState = { code?: number | string; screenId?: string; linked?: boolean };

const signage = {
  getDeviceState: (): Promise<DeviceState> =>
    ipcRenderer.invoke("signage:getDeviceState"),

  saveScreenId: (screenId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:saveScreenId", screenId),

  setLinked: (linked: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:setLinked", linked),

  getAuthToken: (): Promise<string | undefined> =>
    ipcRenderer.invoke("signage:getAuthToken"),

  saveAuthToken: (token: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:saveAuthToken", token),

  clearAuthToken: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:clearAuthToken"),

  resetDevice: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:resetDevice"),

  getClockCalibration: (): Promise<any> =>
    ipcRenderer.invoke("signage:getClockCalibration"),

  saveClockCalibration: (cal: any): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:saveClockCalibration", cal),

  onPowerResume: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("system:power-resume", handler);
    return () => {
      ipcRenderer.removeListener("system:power-resume", handler);
    };
  },
};

const mediaCache = {
  mapToLocal: async (urls: string[]): Promise<Record<string, string>> => {
    return ipcRenderer.invoke("media-cache:map", urls);
  },
  getManifest: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:getManifest");
  },
  getAsset: async (urlOrKey: string): Promise<any> => {
    return ipcRenderer.invoke("media-cache:getAsset", urlOrKey);
  },
  setActiveAssets: async (urls: string[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke("media-cache:setActiveAssets", urls);
  },
  setProtectedAssets: async (source: string, urls: string[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke("media-cache:setProtectedAssets", source, urls);
  },
  acquireReaderLease: (urlOrKey: string): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke("media-cache:acquireReaderLease", urlOrKey);
  },
  releaseReaderLease: (urlOrKey: string): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke("media-cache:releaseReaderLease", urlOrKey);
  },
  cleanup: async (options?: any): Promise<any> => {
    return ipcRenderer.invoke("media-cache:cleanup", options);
  },
  getCleanupDiagnostics: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:getCleanupDiagnostics");
  },
  reconcile: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:reconcile");
  },
  setQuota: async (quotaBytes: number): Promise<any> => {
    return ipcRenderer.invoke("media-cache:setQuota", quotaBytes);
  },
  getStats: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:getStats");
  },
  evict: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:evict");
  },
  purgeCorrupt: async (): Promise<any> => {
    return ipcRenderer.invoke("media-cache:purgeCorrupt");
  },
  getLocalDeliveryUrl: (assetKey: string, originalUrl?: string): string => {
    return `http://127.0.0.1:17654/local-media?key=${encodeURIComponent(assetKey)}${originalUrl ? `&orig=${encodeURIComponent(originalUrl)}` : ""}`;
  },
};

// ✅ Auto Update bridge
const updater = {
  check: (): Promise<any> => ipcRenderer.invoke("updater:check"),
  install: (): Promise<any> => ipcRenderer.invoke("updater:install"),
  onEvent: (cb: (payload: any) => void) => {
    const handler = (_: any, payload: any) => cb(payload);
    ipcRenderer.on("updater:event", handler);
    return () => ipcRenderer.removeListener("updater:event", handler);
  },
};

const iguana = {
  pingServer: (address: string, port: number): Promise<boolean> =>
    ipcRenderer.invoke("ping-server", address, port),
};

const serverConfig = {
  configureMediaProxy: (host: string, port: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("media-proxy:configure-server", host, port),
};

contextBridge.exposeInMainWorld("signage", signage);

const mediaQueue = {
  enqueue: (url: string, options?: any) => ipcRenderer.invoke("media-queue:enqueue", url, options),
  enqueuePlaylist: (playlist: any, basePriority?: number) => ipcRenderer.invoke("media-queue:enqueuePlaylist", playlist, basePriority),
  cancel: (urlOrKey: string) => ipcRenderer.invoke("media-queue:cancel", urlOrKey),
  cancelAll: () => ipcRenderer.invoke("media-queue:cancelAll"),
  pause: () => ipcRenderer.invoke("media-queue:pause"),
  resume: () => ipcRenderer.invoke("media-queue:resume"),
  getStats: () => ipcRenderer.invoke("media-queue:getStats"),
};

contextBridge.exposeInMainWorld("mediaCache", mediaCache);
contextBridge.exposeInMainWorld("mediaQueue", mediaQueue);
contextBridge.exposeInMainWorld("updater", updater);
contextBridge.exposeInMainWorld("iguana", iguana);
contextBridge.exposeInMainWorld("serverConfig", serverConfig);

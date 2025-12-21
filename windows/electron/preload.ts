// electron/preload.ts  (compiled to preload.cjs by your build step)
import { contextBridge, ipcRenderer } from "electron";

type DeviceState = { code?: number | string; screenId?: string };

const signage = {
  getDeviceState: (): Promise<DeviceState> =>
    ipcRenderer.invoke("signage:getDeviceState"),

  saveScreenId: (screenId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:saveScreenId", screenId),

  resetDevice: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:resetDevice"),
};

const mediaCache = {
  mapToLocal: async (urls: string[]): Promise<Record<string, string>> => {
    return ipcRenderer.invoke("media-cache:map", urls);
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

contextBridge.exposeInMainWorld("signage", signage);
contextBridge.exposeInMainWorld("mediaCache", mediaCache);
contextBridge.exposeInMainWorld("updater", updater);

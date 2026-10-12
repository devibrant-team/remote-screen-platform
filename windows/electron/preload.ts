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
contextBridge.exposeInMainWorld("mediaCache", mediaCache);
contextBridge.exposeInMainWorld("updater", updater);
contextBridge.exposeInMainWorld("iguana", iguana);
contextBridge.exposeInMainWorld("serverConfig", serverConfig);

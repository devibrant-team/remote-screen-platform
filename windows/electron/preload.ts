// electron/preload.ts  (compiled to preload.cjs by your build step)
import { contextBridge, ipcRenderer } from "electron";

type DeviceState = { code?: number | string; screenId?: string };

const signage = {
  // Read both code & screenId from main (electron-store lives in main)
  getDeviceState: (): Promise<DeviceState> =>
    ipcRenderer.invoke("signage:getDeviceState"),

  // Persist screenId to main/electron-store
  saveScreenId: (screenId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:saveScreenId", screenId),

  // Clear device data (code & screenId) in main/electron-store
  resetDevice: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("signage:resetDevice"),
};

contextBridge.exposeInMainWorld("signage", signage);

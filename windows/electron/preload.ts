import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("signage", {
  getDeviceState: () => ipcRenderer.invoke("signage:getDeviceState"),
  saveScreenId: (screenId: string) => ipcRenderer.invoke("signage:saveScreenId", screenId),
  resetDevice: () => ipcRenderer.invoke("signage:resetDevice")
});

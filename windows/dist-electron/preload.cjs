"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts  (compiled to preload.cjs by your build step)
const electron_1 = require("electron");
const signage = {
    // Read both code & screenId from main (electron-store lives in main)
    getDeviceState: () => electron_1.ipcRenderer.invoke("signage:getDeviceState"),
    // Persist screenId to main/electron-store
    saveScreenId: (screenId) => electron_1.ipcRenderer.invoke("signage:saveScreenId", screenId),
    // Clear device data (code & screenId) in main/electron-store
    resetDevice: () => electron_1.ipcRenderer.invoke("signage:resetDevice"),
};
electron_1.contextBridge.exposeInMainWorld("signage", signage);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts  (compiled to preload.cjs by your build step)
const electron_1 = require("electron");
const signage = {
    getDeviceState: () => electron_1.ipcRenderer.invoke("signage:getDeviceState"),
    saveScreenId: (screenId) => electron_1.ipcRenderer.invoke("signage:saveScreenId", screenId),
    resetDevice: () => electron_1.ipcRenderer.invoke("signage:resetDevice"),
};
const mediaCache = {
    mapToLocal: async (urls) => {
        return electron_1.ipcRenderer.invoke("media-cache:map", urls);
    },
};
// ✅ Auto Update bridge
const updater = {
    check: () => electron_1.ipcRenderer.invoke("updater:check"),
    install: () => electron_1.ipcRenderer.invoke("updater:install"),
    onEvent: (cb) => {
        const handler = (_, payload) => cb(payload);
        electron_1.ipcRenderer.on("updater:event", handler);
        return () => electron_1.ipcRenderer.removeListener("updater:event", handler);
    },
};
electron_1.contextBridge.exposeInMainWorld("signage", signage);
electron_1.contextBridge.exposeInMainWorld("mediaCache", mediaCache);
electron_1.contextBridge.exposeInMainWorld("updater", updater);

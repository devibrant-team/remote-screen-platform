"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("signage", {
    getDeviceState: () => electron_1.ipcRenderer.invoke("signage:getDeviceState"),
    saveScreenId: (screenId) => electron_1.ipcRenderer.invoke("signage:saveScreenId", screenId),
    resetDevice: () => electron_1.ipcRenderer.invoke("signage:resetDevice")
});

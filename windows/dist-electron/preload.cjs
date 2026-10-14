"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts  (compiled to preload.cjs by your build step)
const electron_1 = require("electron");
const signage = {
    getDeviceState: () => electron_1.ipcRenderer.invoke("signage:getDeviceState"),
    saveScreenId: (screenId) => electron_1.ipcRenderer.invoke("signage:saveScreenId", screenId),
    setLinked: (linked) => electron_1.ipcRenderer.invoke("signage:setLinked", linked),
    getAuthToken: () => electron_1.ipcRenderer.invoke("signage:getAuthToken"),
    saveAuthToken: (token) => electron_1.ipcRenderer.invoke("signage:saveAuthToken", token),
    clearAuthToken: () => electron_1.ipcRenderer.invoke("signage:clearAuthToken"),
    resetDevice: () => electron_1.ipcRenderer.invoke("signage:resetDevice"),
    getClockCalibration: () => electron_1.ipcRenderer.invoke("signage:getClockCalibration"),
    saveClockCalibration: (cal) => electron_1.ipcRenderer.invoke("signage:saveClockCalibration", cal),
    onPowerResume: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on("system:power-resume", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("system:power-resume", handler);
        };
    },
};
const mediaCache = {
    mapToLocal: async (urls) => {
        return electron_1.ipcRenderer.invoke("media-cache:map", urls);
    },
    getManifest: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:getManifest");
    },
    getAsset: async (urlOrKey) => {
        return electron_1.ipcRenderer.invoke("media-cache:getAsset", urlOrKey);
    },
    setActiveAssets: async (urls) => {
        return electron_1.ipcRenderer.invoke("media-cache:setActiveAssets", urls);
    },
    setProtectedAssets: async (source, urls) => {
        return electron_1.ipcRenderer.invoke("media-cache:setProtectedAssets", source, urls);
    },
    acquireReaderLease: (urlOrKey) => {
        return electron_1.ipcRenderer.invoke("media-cache:acquireReaderLease", urlOrKey);
    },
    releaseReaderLease: (urlOrKey) => {
        return electron_1.ipcRenderer.invoke("media-cache:releaseReaderLease", urlOrKey);
    },
    cleanup: async (options) => {
        return electron_1.ipcRenderer.invoke("media-cache:cleanup", options);
    },
    getCleanupDiagnostics: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:getCleanupDiagnostics");
    },
    reconcile: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:reconcile");
    },
    setQuota: async (quotaBytes) => {
        return electron_1.ipcRenderer.invoke("media-cache:setQuota", quotaBytes);
    },
    getStats: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:getStats");
    },
    evict: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:evict");
    },
    purgeCorrupt: async () => {
        return electron_1.ipcRenderer.invoke("media-cache:purgeCorrupt");
    },
    getLocalDeliveryUrl: (assetKey, originalUrl) => {
        return `http://127.0.0.1:17654/local-media?key=${encodeURIComponent(assetKey)}${originalUrl ? `&orig=${encodeURIComponent(originalUrl)}` : ""}`;
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
const iguana = {
    pingServer: (address, port) => electron_1.ipcRenderer.invoke("ping-server", address, port),
};
const serverConfig = {
    configureMediaProxy: (host, port) => electron_1.ipcRenderer.invoke("media-proxy:configure-server", host, port),
};
electron_1.contextBridge.exposeInMainWorld("signage", signage);
const mediaQueue = {
    enqueue: (url, options) => electron_1.ipcRenderer.invoke("media-queue:enqueue", url, options),
    enqueuePlaylist: (playlist, basePriority) => electron_1.ipcRenderer.invoke("media-queue:enqueuePlaylist", playlist, basePriority),
    cancel: (urlOrKey) => electron_1.ipcRenderer.invoke("media-queue:cancel", urlOrKey),
    cancelAll: () => electron_1.ipcRenderer.invoke("media-queue:cancelAll"),
    pause: () => electron_1.ipcRenderer.invoke("media-queue:pause"),
    resume: () => electron_1.ipcRenderer.invoke("media-queue:resume"),
    getStats: () => electron_1.ipcRenderer.invoke("media-queue:getStats"),
};
electron_1.contextBridge.exposeInMainWorld("mediaCache", mediaCache);
electron_1.contextBridge.exposeInMainWorld("mediaQueue", mediaQueue);
electron_1.contextBridge.exposeInMainWorld("updater", updater);
electron_1.contextBridge.exposeInMainWorld("iguana", iguana);
electron_1.contextBridge.exposeInMainWorld("serverConfig", serverConfig);

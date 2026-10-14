"use strict";
// src/utils/mediaStorage/mediaStorageTypes.ts
// Consistent media asset manifest schema & storage contracts across Windows and Android.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CLEANUP_CONFIG = void 0;
exports.DEFAULT_CLEANUP_CONFIG = {
    retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    cleanupIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
    pressureThreshold: 0.90, // 90%
    targetUsageRatio: 0.80, // 80%
    unpinGracePeriodMs: 60 * 1000, // 60 seconds
};

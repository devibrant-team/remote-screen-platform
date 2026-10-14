"use strict";
// src/utils/mediaStorage/mediaDownloadTypes.ts
// Common types & interfaces for the Background Media Download Engine (Phase 2).
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadPriority = void 0;
var DownloadPriority;
(function (DownloadPriority) {
    DownloadPriority[DownloadPriority["ACTIVE_CURRENT"] = 100] = "ACTIVE_CURRENT";
    DownloadPriority[DownloadPriority["ACTIVE_UPCOMING"] = 80] = "ACTIVE_UPCOMING";
    DownloadPriority[DownloadPriority["SCHEDULED_SOON"] = 60] = "SCHEDULED_SOON";
    DownloadPriority[DownloadPriority["OTHER_CACHED"] = 40] = "OTHER_CACHED";
    DownloadPriority[DownloadPriority["LOW_BACKGROUND"] = 20] = "LOW_BACKGROUND";
})(DownloadPriority || (exports.DownloadPriority = DownloadPriority = {}));

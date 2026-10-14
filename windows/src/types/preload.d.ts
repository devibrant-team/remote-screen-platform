// src/types/preload.d.ts
import type {
  MediaManifest,
  MediaAssetRecord,
  ReconcileReport,
  StorageStats,
} from "../utils/mediaStorage/mediaStorageTypes";
import type {
  DownloadQueueStats,
  DownloadQueueTask,
  DownloadTaskOptions,
} from "../utils/mediaStorage/mediaDownloadTypes";

export {};

declare global {
  interface Window {
    signage: {
      getDeviceState: () => Promise<{ code?: number | string; screenId?: string; linked?: boolean }>;
      saveScreenId: (screenId: string) => Promise<{ ok: boolean }>;
      setLinked: (linked: boolean) => Promise<{ ok: boolean }>;
      getAuthToken: () => Promise<string | undefined>;
      saveAuthToken: (token: string) => Promise<{ ok: boolean }>;
      clearAuthToken: () => Promise<{ ok: boolean }>;
      resetDevice: () => Promise<{ ok: boolean }>;
      getClockCalibration?: () => Promise<any>;
      saveClockCalibration?: (cal: any) => Promise<{ ok: boolean }>;
      onPowerResume?: (cb: () => void) => () => void;
    };
    iguana: {
      pingServer: (address: string, port: number) => Promise<boolean>;
    };
    serverConfig: {
      configureMediaProxy: (host: string, port: number) => Promise<{ ok: boolean }>;
    };
    mediaCache: {
      mapToLocal: (urls: string[]) => Promise<Record<string, string>>;
      getManifest: () => Promise<MediaManifest>;
      getAsset: (urlOrKey: string) => Promise<MediaAssetRecord | null>;
      setActiveAssets: (urls: string[]) => Promise<{ ok: boolean }>;
      setProtectedAssets: (source: string, urls: string[]) => Promise<{ ok: boolean }>;
      acquireReaderLease?: (urlOrKey: string) => Promise<{ ok: boolean }>;
      releaseReaderLease?: (urlOrKey: string) => Promise<{ ok: boolean }>;
      cleanup?: (options?: any) => Promise<any>;
      getCleanupDiagnostics?: () => Promise<any>;
      reconcile: () => Promise<ReconcileReport>;
      setQuota: (quotaBytes: number) => Promise<{ ok: boolean; evictedCount: number; freedBytes: number }>;
      getStats: () => Promise<StorageStats>;
      evict: () => Promise<{ evictedCount: number; freedBytes: number }>;
      purgeCorrupt: () => Promise<{ purgedCount: number }>;
      getLocalDeliveryUrl?: (assetKey: string, originalUrl?: string) => string;
    };
    mediaQueue: {
      enqueue: (url: string, options?: DownloadTaskOptions) => Promise<DownloadQueueTask>;
      enqueuePlaylist: (playlist: any, basePriority?: number) => Promise<DownloadQueueTask[]>;
      cancel: (urlOrKey: string) => Promise<{ ok: boolean }>;
      cancelAll: () => Promise<{ ok: boolean }>;
      pause: () => Promise<{ ok: boolean }>;
      resume: () => Promise<{ ok: boolean }>;
      getStats: () => Promise<DownloadQueueStats>;
    };
    updater?: {
      check: () => Promise<any>;
      install: () => Promise<any>;
      onEvent: (cb: (payload: any) => void) => () => void;
    };
  }
}

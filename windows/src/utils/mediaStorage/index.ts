export * from './mediaStorageTypes';
export * from './assetKey';
export * from './mediaStorageEngine';
export * from './mediaDownloadTypes';
export * from './mediaSecurity';
export * from './mediaDownloadQueue';
export * from './mediaResolver';

export const mediaCacheClient = {
  mapToLocal: async (urls: string[]): Promise<Record<string, string>> => {
    if (typeof window !== 'undefined' && (window as any).mediaCache?.mapToLocal) {
      return (window as any).mediaCache.mapToLocal(urls);
    }
    const res: Record<string, string> = {};
    for (const u of urls) res[u] = u;
    return res;
  },
  getManifest: async () => (window as any).mediaCache?.getManifest(),
  getAsset: async (urlOrKey: string) => (window as any).mediaCache?.getAsset(urlOrKey),
  setActiveAssets: async (urls: string[]) => (window as any).mediaCache?.setActiveAssets(urls),
  setProtectedAssets: async (source: string, urls: string[]) => (window as any).mediaCache?.setProtectedAssets?.(source, urls),
  acquireReaderLease: (urlOrKey: string) => (window as any).mediaCache?.acquireReaderLease?.(urlOrKey),
  releaseReaderLease: (urlOrKey: string) => (window as any).mediaCache?.releaseReaderLease?.(urlOrKey),
  cleanup: async (options?: any) => (window as any).mediaCache?.cleanup?.(options),
  getCleanupDiagnostics: async () => (window as any).mediaCache?.getCleanupDiagnostics?.(),
  reconcile: async () => (window as any).mediaCache?.reconcile(),
  setQuota: async (bytes: number) => (window as any).mediaCache?.setQuota(bytes),
  getStats: async () => (window as any).mediaCache?.getStats(),
  evict: async () => (window as any).mediaCache?.evict(),
  purgeCorrupt: async () => (window as any).mediaCache?.purgeCorrupt(),
  getLocalDeliveryUrl: (assetKey: string, originalUrl?: string) => (window as any).mediaCache?.getLocalDeliveryUrl?.(assetKey, originalUrl) || `http://127.0.0.1:17654/local-media?key=${encodeURIComponent(assetKey)}${originalUrl ? `&orig=${encodeURIComponent(originalUrl)}` : ''}`,
};

export const mediaQueueClient = {
  enqueue: async (url: string, options?: any) => (window as any).mediaQueue?.enqueue(url, options),
  enqueuePlaylist: async (playlist: any, basePriority?: number) => (window as any).mediaQueue?.enqueuePlaylist(playlist, basePriority),
  cancel: async (urlOrKey: string) => (window as any).mediaQueue?.cancel(urlOrKey),
  cancelAll: async () => (window as any).mediaQueue?.cancelAll(),
  pause: async () => (window as any).mediaQueue?.pause(),
  resume: async () => (window as any).mediaQueue?.resume(),
  getStats: async () => (window as any).mediaQueue?.getStats(),
};

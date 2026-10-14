// src/utils/mediaStorage/mediaStorageTypes.ts
// Consistent media asset manifest schema & storage contracts across Windows and Android.

export type AssetStatus =
  | "completed"    // Verified file exists on disk, size > 0 matches recorded sizeBytes, passed verification
  | "partial"      // In-flight or interrupted download (e.g. .part file exists or incomplete content)
  | "stale"        // Server reported new ETag/Last-Modified or content explicitly invalidated
  | "missing"      // Present in manifest but absent from local filesystem
  | "corrupt"      // File exists but size mismatch / 0 bytes / verification failure
  | "downloading"  // Currently downloading in progress
  | "failed";      // Download or acquisition failed

export interface AssetValidationMeta {
  etag?: string | null;
  lastModified?: string | null;
  contentLength?: number | null;
  mimeType?: string | null;
  sha256?: string | null;
  verifiedAt?: number;
}

export interface AssetTimestamps {
  createdAt: number;       // When record was first created
  updatedAt: number;       // When record or file was last updated
  lastAccessedAt: number;  // Last time requested, viewed, or touched (LRU basis)
}

export interface MediaAssetRecord {
  /** Original URL from playlist / server */
  url: string;
  /** Normalized stable asset key (deterministic hash of normalized URL) */
  assetKey: string;
  /** Local file path (file:/// URI or absolute filesystem path) on disk */
  localPath: string;
  /** Byte size of the local media file */
  sizeBytes: number;
  /** Server & local validation metadata */
  validation: AssetValidationMeta;
  /** Current state of the asset */
  status: AssetStatus;
  /** Access and lifecycle timestamps */
  timestamps: AssetTimestamps;
  /** Protected from accidental eviction when active in current or upcoming playback */
  isActive?: boolean;
  /** Timestamp when asset was released from active protection (for unpin grace period) */
  unpinnedAt?: number | null;
  /** Active protection sources currently pinning this asset */
  protectionSources?: string[];
  /** Active reader count (e.g. streaming/buffering playback leases) */
  activeReaders?: number;
  /** Optional error message if corrupt or failed */
  error?: string | null;
}

export interface MediaManifest {
  /** Manifest schema version */
  version: number;
  /** Timestamp when manifest was last persisted */
  updatedAt: number;
  /** Maximum storage quota in bytes (configurable per device tier) */
  quotaBytes: number;
  /** Assets dictionary keyed by stable assetKey */
  assets: Record<string, MediaAssetRecord>;
}

export interface StorageStats {
  usedBytes: number;
  quotaBytes: number;
  freeBytes: number;
  totalAssets: number;
  completedAssets: number;
  activeAssets: number;
  missingAssets: number;
  corruptAssets: number;
}

export interface ReconcileReport {
  total: number;
  completed: number;
  missing: number;
  corrupt: number;
  stale: number;
  orphansCleaned: number;
  recoveredFromBackup: boolean;
  recoveredFromDiskScan: boolean;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface DownloadResult {
  status: number;
  headers: Record<string, string>;
  bytesWritten: number;
}

export interface FileSystemAdapter {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; mtimeMs?: number } | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  rename(src: string, dest: string): Promise<void>;
  copyFile?(src: string, dest: string): Promise<void>;
  ensureDir(dirPath: string): Promise<void>;
  readDir(dirPath: string): Promise<FileEntry[]>;
  computeSha256?(path: string): Promise<string>;
  downloadFile(
    url: string,
    destPath: string,
    options?: { headers?: Record<string, string> }
  ): Promise<DownloadResult>;
}

export interface StorageCleanupConfig {
  /** Unused media retention target in ms: default 7 days (604,800,000 ms) */
  retentionMs: number;
  /** Periodic cleanup interval in ms: default 6 hours (21,600,000 ms) */
  cleanupIntervalMs: number;
  /** Storage pressure threshold (0.0 - 1.0): default 0.90 (90% of quota) */
  pressureThreshold: number;
  /** Target usage ratio after cleanup (e.g. 0.80 = 80% usage / 20% headroom) */
  targetUsageRatio: number;
  /** Unpin grace period in ms to protect recently inactive assets from immediate eviction: default 60s */
  unpinGracePeriodMs: number;
}

export const DEFAULT_CLEANUP_CONFIG: StorageCleanupConfig = {
  retentionMs: 7 * 24 * 60 * 60 * 1000,      // 7 days
  cleanupIntervalMs: 6 * 60 * 60 * 1000,     // 6 hours
  pressureThreshold: 0.90,                   // 90%
  targetUsageRatio: 0.80,                    // 80%
  unpinGracePeriodMs: 60 * 1000,             // 60 seconds
};

export interface CleanupDiagnostics {
  cacheBytes: number;
  quotaBytes: number;
  protectedAssets: number;
  unprotectedAssets: number;
  reclaimedBytes: number;
  deletedAssets: number;
  failedDeletions: number;
  lastCleanupAt: number | null;
  orphansCleaned: number;
  abandonedPartsCleaned: number;
  pressureDetected: boolean;
}

export interface CleanupOptions {
  /** Force cleanup even if storage is below pressure threshold */
  force?: boolean;
  /** Estimated bytes needed for an upcoming download */
  requiredBytes?: number;
  /** Reason triggering the cleanup run */
  reason?: "startup" | "periodic" | "pressure" | "pre_download" | "manual";
}

export interface CleanupResult {
  reclaimedBytes: number;
  deletedAssets: number;
  failedDeletions: number;
  orphansCleaned: number;
  abandonedPartsCleaned: number;
  pressureDetected: boolean;
  quotaExceeded: boolean;
  insufficientStorage: boolean;
  diagnostics: CleanupDiagnostics;
}

export interface MediaStorageOptions {
  baseDir: string;
  quotaBytes?: number;
  fs: FileSystemAdapter;
  cleanupConfig?: Partial<StorageCleanupConfig>;
}

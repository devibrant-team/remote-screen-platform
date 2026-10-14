// src/utils/mediaStorage/mediaStorageEngine.ts
// Platform-agnostic Persistent Media Storage, Manifest Engine & Storage Retention (Phase 4).

import type {
  AssetStatus,
  CleanupDiagnostics,
  CleanupOptions,
  CleanupResult,
  FileSystemAdapter,
  MediaAssetRecord,
  MediaManifest,
  MediaStorageOptions,
  ReconcileReport,
  StorageCleanupConfig,
  StorageStats,
} from "./mediaStorageTypes";
import { DEFAULT_CLEANUP_CONFIG } from "./mediaStorageTypes";
import {
  extractExtension,
  generateAssetKey,
  normalizeMediaUrl,
} from "./assetKey";

const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB default
const MANIFEST_VERSION = 1;

export class MediaStorageEngine {
  private baseDir: string;
  private manifestPath: string;
  private tempManifestPath: string;
  private backupManifestPath: string;
  private quotaBytes: number;
  private fs: FileSystemAdapter;
  private manifest: MediaManifest | null = null;
  private inFlightDownloads = new Map<string, Promise<MediaAssetRecord>>();
  private writeLock: Promise<void> = Promise.resolve();

  // Phase 4: Retention, Protection & Reader Leases
  private config: StorageCleanupConfig;
  private protectionSources = new Map<string, Set<string>>();
  private readerLeases = new Map<string, number>();
  private unpinTimestamps = new Map<string, number>();
  private cleanupTimer: any = null;
  private downloadQueue: any = null;
  private lastCleanupAt: number | null = null;

  private diagnostics: CleanupDiagnostics = {
    cacheBytes: 0,
    quotaBytes: DEFAULT_QUOTA_BYTES,
    protectedAssets: 0,
    unprotectedAssets: 0,
    reclaimedBytes: 0,
    deletedAssets: 0,
    failedDeletions: 0,
    lastCleanupAt: null,
    orphansCleaned: 0,
    abandonedPartsCleaned: 0,
    pressureDetected: false,
  };

  constructor(options: MediaStorageOptions) {
    this.baseDir = options.baseDir.replace(/[/\\]+$/, "");
    this.fs = options.fs;
    this.quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
    this.manifestPath = `${this.baseDir}/manifest.json`;
    this.tempManifestPath = `${this.baseDir}/manifest.json.tmp`;
    this.backupManifestPath = `${this.baseDir}/manifest.json.bak`;
    this.config = {
      ...DEFAULT_CLEANUP_CONFIG,
      ...(options.cleanupConfig || {}),
    };
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public getCleanupConfig(): StorageCleanupConfig {
    return { ...this.config };
  }

  public setCleanupConfig(cfg: Partial<StorageCleanupConfig>): void {
    this.config = { ...this.config, ...cfg };
    if (cfg.cleanupIntervalMs && this.cleanupTimer) {
      this.startPeriodicCleanup();
    }
  }

  public setDownloadQueue(queue: any): void {
    this.downloadQueue = queue;
  }

  /**
   * Safe startup initialization & reconciliation.
   */
  public async reconcileStartup(): Promise<ReconcileReport> {
    await this.fs.ensureDir(this.baseDir);

    let recoveredFromBackup = false;
    let recoveredFromDiskScan = false;

    // 1. Attempt loading primary manifest
    let loadedManifest = await this.tryLoadManifest(this.manifestPath);

    // 2. If primary failed or invalid, attempt loading backup
    if (!loadedManifest) {
      loadedManifest = await this.tryLoadManifest(this.backupManifestPath);
      if (loadedManifest) {
        recoveredFromBackup = true;
      }
    }

    // 3. If both failed, initialize a fresh manifest
    if (!loadedManifest) {
      loadedManifest = {
        version: MANIFEST_VERSION,
        updatedAt: Date.now(),
        quotaBytes: this.quotaBytes,
        assets: {},
      };
      recoveredFromDiskScan = true;
    }

    this.manifest = loadedManifest;
    if (this.quotaBytes !== DEFAULT_QUOTA_BYTES) {
      this.manifest.quotaBytes = this.quotaBytes;
    }

    // 4. Scan filesystem for leftover temporary files and existing media files
    let orphansCleaned = 0;
    const diskEntries = await this.fs.readDir(this.baseDir).catch(() => []);

    for (const entry of diskEntries) {
      if (entry.isDirectory) continue;
      // Clean leftover .part or .tmp files from previous crashed sessions
      if (entry.name.endsWith(".part") || entry.name.endsWith(".tmp")) {
        const fullPath = `${this.baseDir}/${entry.name}`;
        await this.fs.deleteFile(fullPath).catch(() => {});
        orphansCleaned++;
      }
    }

    // 5. Reconcile all entries in manifest against filesystem state
    let completed = 0;
    let missing = 0;
    let corrupt = 0;
    let stale = 0;

    const assetEntries = Object.entries(this.manifest.assets);
    for (const [key, record] of assetEntries) {
      const diskStat = await this.fs.stat(record.localPath);

      if (!diskStat) {
        record.status = "missing";
        record.error = "File not found on local filesystem";
        missing++;
      } else if (diskStat.size === 0) {
        record.status = "corrupt";
        record.sizeBytes = 0;
        record.error = "Zero byte file detected on disk";
        corrupt++;
      } else if (record.sizeBytes > 0 && diskStat.size !== record.sizeBytes) {
        record.status = "corrupt";
        record.error = `Size mismatch: expected ${record.sizeBytes}, found ${diskStat.size}`;
        corrupt++;
      } else {
        record.status = "completed";
        record.sizeBytes = diskStat.size;
        record.error = null;
        completed++;
      }
    }

    // 6. Check for orphaned media files on disk not registered in manifest
    const manifestPaths = new Set(
      Object.values(this.manifest.assets).map((a) => a.localPath.replace(/\\/g, "/"))
    );
    for (const entry of diskEntries) {
      if (entry.isDirectory) continue;
      const fullPath = `${this.baseDir}/${entry.name}`.replace(/\\/g, "/");
      if (
        !entry.name.endsWith(".json") &&
        !entry.name.endsWith(".bak") &&
        !entry.name.endsWith(".tmp") &&
        !entry.name.endsWith(".part") &&
        !manifestPaths.has(fullPath)
      ) {
        await this.fs.deleteFile(fullPath).catch(() => {});
        orphansCleaned++;
      }
    }

    await this.saveManifestAtomic();

    // Start periodic background cleanup
    this.startPeriodicCleanup();

    return {
      total: assetEntries.length,
      completed,
      missing,
      corrupt,
      stale,
      orphansCleaned,
      recoveredFromBackup,
      recoveredFromDiskScan,
    };
  }

  private async tryLoadManifest(filePath: string): Promise<MediaManifest | null> {
    try {
      const exists = await this.fs.exists(filePath);
      if (!exists) return null;
      const raw = await this.fs.readFile(filePath);
      if (!raw || !raw.trim()) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.assets && typeof parsed.assets === "object") {
        return parsed as MediaManifest;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async saveManifestAtomic(): Promise<void> {
    const run = async () => {
      if (!this.manifest) return;
      this.manifest.updatedAt = Date.now();
      const content = JSON.stringify(this.manifest, null, 2);

      await this.fs.writeFile(this.tempManifestPath, content);
      await this.fs.rename(this.tempManifestPath, this.manifestPath);

      if (this.fs.copyFile) {
        await this.fs.copyFile(this.manifestPath, this.backupManifestPath).catch(() => {});
      } else {
        await this.fs.writeFile(this.backupManifestPath, content).catch(() => {});
      }
    };

    this.writeLock = this.writeLock.then(run, run);
    return this.writeLock;
  }

  public getManifest(): MediaManifest {
    if (!this.manifest) {
      return {
        version: MANIFEST_VERSION,
        updatedAt: Date.now(),
        quotaBytes: this.quotaBytes,
        assets: {},
      };
    }
    return this.manifest;
  }

  public getAsset(urlOrKey: string): MediaAssetRecord | null {
    if (!this.manifest) return null;
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    return this.manifest.assets[key] || null;
  }

  public async setQuota(bytes: number): Promise<{ evictedCount: number; freedBytes: number }> {
    this.quotaBytes = bytes;
    if (this.manifest) {
      this.manifest.quotaBytes = bytes;
      await this.saveManifestAtomic();
    }
    const result = await this.performCleanup({ force: true, reason: "pressure" });
    return { evictedCount: result.deletedAssets, freedBytes: result.reclaimedBytes };
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4: Asset Protection & Leases
  // ─────────────────────────────────────────────────────────────

  /**
   * Sets the protected asset URLs for a specific named source.
   * Sources: "current_playlist", "upcoming_playlist", "default_playlist", "interactive_playlist", etc.
   * When a playlist changes, replacing its entry automatically releases assets no longer in use!
   */
  public async setProtectedAssets(source: string, urls: string[]): Promise<void> {
    const assetKeys = new Set<string>();
    for (const u of urls) {
      const norm = normalizeMediaUrl(u);
      if (norm) assetKeys.add(generateAssetKey(norm));
    }

    if (assetKeys.size === 0) {
      this.protectionSources.delete(source);
    } else {
      this.protectionSources.set(source, assetKeys);
    }

    // Recompute overall protected status for manifest records
    if (this.manifest) {
      const now = Date.now();
      for (const [key, record] of Object.entries(this.manifest.assets)) {
        const wasProtected = !!record.isActive;
        const matchingSources: string[] = [];

        for (const [src, keys] of this.protectionSources.entries()) {
          if (keys.has(key)) matchingSources.push(src);
        }

        const hasReaders = (this.readerLeases.get(key) || 0) > 0;
        const isNowProtected = matchingSources.length > 0 || hasReaders;

        record.protectionSources = matchingSources;
        record.activeReaders = this.readerLeases.get(key) || 0;
        record.isActive = isNowProtected;

        if (isNowProtected) {
          record.timestamps.lastAccessedAt = now;
          this.unpinTimestamps.delete(key);
          record.unpinnedAt = null;
        } else if (wasProtected && !isNowProtected) {
          // Transitioned to unprotected -> start unpin grace period
          this.unpinTimestamps.set(key, now);
          record.unpinnedAt = now;
        }
      }
      await this.saveManifestAtomic();
    }
  }

  /**
   * Backwards-compatible setActiveAssets mapping to "default" source.
   */
  public async setActiveAssets(activeUrls: string[]): Promise<void> {
    await this.setProtectedAssets("default", activeUrls);
  }

  public async pinAsset(url: string, active = true): Promise<void> {
    const norm = normalizeMediaUrl(url);
    const key = generateAssetKey(norm);
    const current = this.protectionSources.get("manual") || new Set<string>();
    if (active) {
      current.add(key);
      this.protectionSources.set("manual", current);
    } else {
      current.delete(key);
      if (current.size === 0) this.protectionSources.delete("manual");
    }
    await this.setProtectedAssets("manual", Array.from(current));
  }

  /**
   * Acquires a playback reader lease for an asset (e.g. streaming HTTP Range request or mounted player).
   * Returns a release callback.
   */
  public acquireReaderLease(urlOrKey: string): () => void {
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest?.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    const current = this.readerLeases.get(key) || 0;
    this.readerLeases.set(key, current + 1);

    if (this.manifest?.assets[key]) {
      this.manifest.assets[key].isActive = true;
      this.manifest.assets[key].activeReaders = current + 1;
      this.manifest.assets[key].timestamps.lastAccessedAt = Date.now();
      this.unpinTimestamps.delete(key);
      this.manifest.assets[key].unpinnedAt = null;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseReaderLease(key);
    };
  }

  public releaseReaderLease(urlOrKey: string): void {
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest?.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    const current = this.readerLeases.get(key) || 0;
    if (current <= 1) {
      this.readerLeases.delete(key);
      // Check if still protected by any source
      let stillProtected = false;
      for (const keys of this.protectionSources.values()) {
        if (keys.has(key)) {
          stillProtected = true;
          break;
        }
      }
      if (!stillProtected) {
        const now = Date.now();
        this.unpinTimestamps.set(key, now);
        if (this.manifest?.assets[key]) {
          this.manifest.assets[key].isActive = false;
          this.manifest.assets[key].unpinnedAt = now;
          this.manifest.assets[key].activeReaders = 0;
        }
      } else if (this.manifest?.assets[key]) {
        this.manifest.assets[key].activeReaders = 0;
      }
    } else {
      this.readerLeases.set(key, current - 1);
      if (this.manifest?.assets[key]) {
        this.manifest.assets[key].activeReaders = current - 1;
      }
    }
  }

  public getReaderLeaseCount(urlOrKey: string): number {
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest?.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    return this.readerLeases.get(key) || 0;
  }

  /**
   * Evaluates whether an asset is currently protected from eviction:
   * 1. Active reader lease
   * 2. Active in any protection source (current, upcoming, default, interactive)
   * 3. Currently in unpin grace period (< 60s)
   * 4. Currently downloading in queue
   */
  public isAssetProtected(assetKey: string): boolean {
    // 1. Reader leases
    if ((this.readerLeases.get(assetKey) || 0) > 0) return true;

    // 2. Protection sources
    for (const keys of this.protectionSources.values()) {
      if (keys.has(assetKey)) return true;
    }

    // 3. Unpin grace period
    const unpinnedAt = this.unpinTimestamps.get(assetKey);
    if (unpinnedAt && Date.now() - unpinnedAt < this.config.unpinGracePeriodMs) {
      return true;
    }

    // 4. Download queue active task
    if (this.downloadQueue && typeof this.downloadQueue.isAssetActive === "function") {
      if (this.downloadQueue.isAssetActive(assetKey)) return true;
    }

    // 5. Manifest flag
    if (this.manifest?.assets[assetKey]?.isActive) return true;

    return false;
  }

  public touchAsset(url: string): void {
    if (!this.manifest) return;
    const norm = normalizeMediaUrl(url);
    const key = generateAssetKey(norm);
    const rec = this.manifest.assets[key];
    if (rec) {
      rec.timestamps.lastAccessedAt = Date.now();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Phase 4: Retention, Storage Cleanup & Eviction Engine
  // ─────────────────────────────────────────────────────────────

  /**
   * Main media retention and cleanup routine.
   * Fulfills all Phase 4 requirements:
   * - Never deletes protected media (active readers, current/upcoming/default playlists).
   * - Under quota pressure (>90% or requiredBytes): LRU eviction preferring assets >= 7 days old, then newer if needed.
   * - Does NOT delete verified cached files merely because 7 days elapsed when storage is healthy (<90%).
   * - Safely cleans abandoned .part files without touching active downloads.
   * - Cleans orphans, missing, and corrupt files.
   * - Reports diagnostics.
   */
  public async performCleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
    if (!this.manifest) {
      await this.reconcileStartup();
    }

    const now = Date.now();
    let reclaimedBytes = 0;
    let deletedAssets = 0;
    let failedDeletions = 0;
    let orphansCleaned = 0;
    let abandonedPartsCleaned = 0;

    // 1. Clean abandoned .part files safely (Requirement 7)
    const diskEntries = await this.fs.readDir(this.baseDir).catch(() => []);
    for (const entry of diskEntries) {
      if (entry.isDirectory) continue;
      if (entry.name.endsWith(".part")) {
        const fullPartPath = `${this.baseDir}/${entry.name}`;
        // Check if downloadQueue is actively working on this part file
        const isActiveDownload =
          this.downloadQueue &&
          typeof this.downloadQueue.isPartFileActive === "function" &&
          this.downloadQueue.isPartFileActive(entry.name);

        if (!isActiveDownload) {
          // Check file age (abandoned threshold: 5 minutes unless startup/forced)
          const stat = await this.fs.stat(fullPartPath).catch(() => null);
          const isRecent = stat && stat.mtimeMs && now - stat.mtimeMs < 5 * 60 * 1000;
          if (!isRecent || options.reason === "startup") {
            try {
              await this.fs.deleteFile(fullPartPath);
              abandonedPartsCleaned++;
            } catch {
              failedDeletions++;
            }
          }
        }
      }
    }

    // 2. Clean orphaned media files on disk not registered in manifest (Requirement 8)
    const manifestPaths = new Set(
      Object.values(this.manifest!.assets).map((a) => a.localPath.replace(/\\/g, "/"))
    );
    for (const entry of diskEntries) {
      if (entry.isDirectory) continue;
      const fullPath = `${this.baseDir}/${entry.name}`.replace(/\\/g, "/");
      if (
        !entry.name.endsWith(".json") &&
        !entry.name.endsWith(".bak") &&
        !entry.name.endsWith(".tmp") &&
        !entry.name.endsWith(".part") &&
        !manifestPaths.has(fullPath)
      ) {
        try {
          await this.fs.deleteFile(fullPath);
          orphansCleaned++;
        } catch {
          failedDeletions++;
        }
      }
    }

    // 3. Reconcile manifest entries & calculate total used bytes
    let totalUsedBytes = 0;
    const completedAssets: MediaAssetRecord[] = [];

    for (const [key, record] of Object.entries(this.manifest!.assets)) {
      if (record.status === "completed") {
        const diskStat = await this.fs.stat(record.localPath).catch(() => null);
        if (!diskStat) {
          record.status = "missing";
        } else if (diskStat.size === 0 || (record.sizeBytes > 0 && diskStat.size !== record.sizeBytes)) {
          record.status = "corrupt";
          await this.fs.deleteFile(record.localPath).catch(() => {});
        } else {
          totalUsedBytes += record.sizeBytes || 0;
          completedAssets.push(record);
        }
      }
    }

    // Purge missing/corrupt records
    for (const [key, record] of Object.entries(this.manifest!.assets)) {
      if (record.status === "missing" || record.status === "corrupt") {
        delete this.manifest!.assets[key];
      }
    }

    // 4. Evaluate Storage Pressure Threshold (Requirement 2 & 5)
    const quotaBytes = this.manifest!.quotaBytes;
    const pressureThresholdBytes = quotaBytes * this.config.pressureThreshold;
    const targetLimitBytes = Math.min(
      quotaBytes * this.config.targetUsageRatio,
      options.requiredBytes ? Math.max(0, quotaBytes - options.requiredBytes) : quotaBytes * this.config.targetUsageRatio
    );

    const isPressure =
      totalUsedBytes > pressureThresholdBytes ||
      (options.requiredBytes != null && totalUsedBytes + options.requiredBytes > quotaBytes);
    const isQuotaExceeded = totalUsedBytes > quotaBytes;

    // Requirement 6: Do not delete verified cached media merely because 7 days elapsed when storage is healthy
    const shouldEvict = isPressure || isQuotaExceeded || options.force;

    let insufficientStorage = false;

    if (shouldEvict && totalUsedBytes > targetLimitBytes) {
      // Filter candidates: strictly UNPROTECTED assets
      const candidates = completedAssets.filter((rec) => !this.isAssetProtected(rec.assetKey));

      // Two-tier LRU sorting (Requirement 5):
      // Tier 1: Assets unused for >= retentionMs (7 days)
      // Tier 2: Assets unused for < retentionMs (newer)
      const tier1: MediaAssetRecord[] = [];
      const tier2: MediaAssetRecord[] = [];

      for (const rec of candidates) {
        const lastAccess = rec.timestamps.lastAccessedAt || rec.timestamps.createdAt || 0;
        if (now - lastAccess >= this.config.retentionMs) {
          tier1.push(rec);
        } else {
          tier2.push(rec);
        }
      }

      // Sort both tiers by LRU: oldest lastAccessedAt first
      tier1.sort((a, b) => (a.timestamps.lastAccessedAt || 0) - (b.timestamps.lastAccessedAt || 0));
      tier2.sort((a, b) => (a.timestamps.lastAccessedAt || 0) - (b.timestamps.lastAccessedAt || 0));

      const evictionQueue = [...tier1, ...tier2];

      for (const rec of evictionQueue) {
        if (totalUsedBytes <= targetLimitBytes) break;

        try {
          await this.fs.deleteFile(rec.localPath);
          totalUsedBytes -= rec.sizeBytes || 0;
          reclaimedBytes += rec.sizeBytes || 0;
          deletedAssets++;
          delete this.manifest!.assets[rec.assetKey];
        } catch {
          failedDeletions++;
        }
      }

      // Requirement 11: Do not evict protected media even if quota is exceeded
      if (totalUsedBytes > quotaBytes || (options.requiredBytes && totalUsedBytes + options.requiredBytes > quotaBytes)) {
        insufficientStorage = true;
      }
    }

    this.lastCleanupAt = now;

    // Count protected vs unprotected completed assets
    let protectedCount = 0;
    let unprotectedCount = 0;
    for (const [key, rec] of Object.entries(this.manifest!.assets)) {
      if (rec.status === "completed") {
        if (this.isAssetProtected(key)) {
          protectedCount++;
        } else {
          unprotectedCount++;
        }
      }
    }

    // Update diagnostics (Requirement 12)
    this.diagnostics = {
      cacheBytes: totalUsedBytes,
      quotaBytes,
      protectedAssets: protectedCount,
      unprotectedAssets: unprotectedCount,
      reclaimedBytes,
      deletedAssets,
      failedDeletions,
      lastCleanupAt: this.lastCleanupAt,
      orphansCleaned,
      abandonedPartsCleaned,
      pressureDetected: isPressure,
    };

    if (deletedAssets > 0 || orphansCleaned > 0 || abandonedPartsCleaned > 0) {
      await this.saveManifestAtomic();
    }

    return {
      reclaimedBytes,
      deletedAssets,
      failedDeletions,
      orphansCleaned,
      abandonedPartsCleaned,
      pressureDetected: isPressure,
      quotaExceeded: totalUsedBytes > quotaBytes,
      insufficientStorage,
      diagnostics: { ...this.diagnostics },
    };
  }

  /**
   * Backwards-compatible eviction hook calling performCleanup.
   */
  public async evictIfNeeded(): Promise<{ evictedCount: number; freedBytes: number }> {
    const res = await this.performCleanup({ reason: "pressure" });
    return { evictedCount: res.deletedAssets, freedBytes: res.reclaimedBytes };
  }

  public getCleanupDiagnostics(): CleanupDiagnostics {
    return { ...this.diagnostics };
  }

  /**
   * Starts periodic cleanup timer running every cleanupIntervalMs (default 6h).
   */
  public startPeriodicCleanup(): void {
    this.stopPeriodicCleanup();
    this.cleanupTimer = setInterval(() => {
      this.performCleanup({ reason: "periodic" }).catch(() => {});
    }, this.config.cleanupIntervalMs);

    if (typeof this.cleanupTimer?.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  public stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Acquires/downloads media asset into persistent storage.
   */
  public async acquireAsset(
    url: string,
    options?: { forceFresh?: boolean; headers?: Record<string, string> }
  ): Promise<MediaAssetRecord> {
    if (!this.manifest) {
      await this.reconcileStartup();
    }

    const normUrl = normalizeMediaUrl(url);
    if (!normUrl) {
      throw new Error("Invalid or empty media URL");
    }

    const assetKey = generateAssetKey(normUrl);

    // 1. Check if already completed and valid on disk
    const existing = this.manifest!.assets[assetKey];
    if (existing && existing.status === "completed" && !options?.forceFresh) {
      const diskStat = await this.fs.stat(existing.localPath);
      if (diskStat && diskStat.size > 0 && diskStat.size === existing.sizeBytes) {
        existing.timestamps.lastAccessedAt = Date.now();
        return { ...existing };
      }
    }

    // 2. Coalesce concurrent downloads for the same asset key
    const inFlight = this.inFlightDownloads.get(assetKey);
    if (inFlight) {
      return inFlight;
    }

    const downloadPromise = this.performAcquire(normUrl, assetKey, options);
    this.inFlightDownloads.set(assetKey, downloadPromise);

    try {
      const record = await downloadPromise;
      return record;
    } finally {
      this.inFlightDownloads.delete(assetKey);
    }
  }

  private async performAcquire(
    url: string,
    assetKey: string,
    options?: { headers?: Record<string, string> }
  ): Promise<MediaAssetRecord> {
    const ext = extractExtension(url, ".media");
    const targetFileName = `${assetKey}${ext}`;
    const targetFilePath = `${this.baseDir}/${targetFileName}`;
    const tempFilePath = `${targetFilePath}.part`;

    const now = Date.now();

    const record: MediaAssetRecord = {
      url,
      assetKey,
      localPath: targetFilePath,
      sizeBytes: 0,
      validation: {
        verifiedAt: now,
      },
      status: "downloading",
      timestamps: {
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      },
      isActive: false,
    };

    this.manifest!.assets[assetKey] = record;

    try {
      const downloadResult = await this.fs.downloadFile(url, tempFilePath, {
        headers: options?.headers,
      });

      if (downloadResult.status < 200 || downloadResult.status >= 300) {
        throw new Error(`HTTP ${downloadResult.status} download failure`);
      }

      const stat = await this.fs.stat(tempFilePath);
      if (!stat || stat.size === 0) {
        throw new Error("Downloaded file is 0 bytes or missing");
      }

      const contentLengthHeader = downloadResult.headers["content-length"];
      if (contentLengthHeader) {
        const expectedBytes = Number(contentLengthHeader);
        if (!isNaN(expectedBytes) && expectedBytes > 0 && stat.size !== expectedBytes) {
          throw new Error(
            `File size mismatch: header reported ${expectedBytes} bytes, actual was ${stat.size} bytes`
          );
        }
      }

      let sha256: string | null = null;
      if (this.fs.computeSha256) {
        sha256 = await this.fs.computeSha256(tempFilePath).catch(() => null);
      }

      await this.fs.rename(tempFilePath, targetFilePath);

      record.sizeBytes = stat.size;
      record.status = "completed";
      record.error = null;
      record.validation = {
        etag: downloadResult.headers["etag"] || null,
        lastModified: downloadResult.headers["last-modified"] || null,
        contentLength: stat.size,
        mimeType: downloadResult.headers["content-type"] || null,
        sha256,
        verifiedAt: Date.now(),
      };
      record.timestamps.updatedAt = Date.now();
      record.timestamps.lastAccessedAt = Date.now();

      await this.performCleanup({ requiredBytes: stat.size, reason: "pre_download" });
      await this.saveManifestAtomic();

      return { ...record };
    } catch (err: any) {
      await this.fs.deleteFile(tempFilePath).catch(() => {});
      record.status = "failed";
      record.error = err?.message || "Download failed";
      record.timestamps.updatedAt = Date.now();
      await this.saveManifestAtomic();
      throw err;
    }
  }

  public async mapUrls(urls: string[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    for (const url of urls) {
      try {
        const record = await this.acquireAsset(url);
        if (record && record.status === "completed") {
          const normalizedPath = record.localPath.replace(/\\/g, "/");
          results[url] = normalizedPath.startsWith("file://")
            ? normalizedPath
            : `file://${normalizedPath}`;
        } else {
          results[url] = url;
        }
      } catch {
        results[url] = url;
      }
    }
    return results;
  }

  public getStorageStats(): StorageStats {
    if (!this.manifest) {
      return {
        usedBytes: 0,
        quotaBytes: this.quotaBytes,
        freeBytes: this.quotaBytes,
        totalAssets: 0,
        completedAssets: 0,
        activeAssets: 0,
        missingAssets: 0,
        corruptAssets: 0,
      };
    }

    let usedBytes = 0;
    let completedAssets = 0;
    let activeAssets = 0;
    let missingAssets = 0;
    let corruptAssets = 0;

    for (const [key, rec] of Object.entries(this.manifest.assets)) {
      if (rec.status === "completed") {
        usedBytes += rec.sizeBytes || 0;
        completedAssets++;
      } else if (rec.status === "missing") {
        missingAssets++;
      } else if (rec.status === "corrupt") {
        corruptAssets++;
      }
      if (this.isAssetProtected(key)) {
        activeAssets++;
      }
    }

    const freeBytes = Math.max(0, this.manifest.quotaBytes - usedBytes);

    return {
      usedBytes,
      quotaBytes: this.manifest.quotaBytes,
      freeBytes,
      totalAssets: Object.keys(this.manifest.assets).length,
      completedAssets,
      activeAssets,
      missingAssets,
      corruptAssets,
    };
  }

  public async purgeCorruptOrMissing(): Promise<{ purgedCount: number }> {
    if (!this.manifest) return { purgedCount: 0 };
    let purgedCount = 0;

    for (const [key, rec] of Object.entries(this.manifest.assets)) {
      if (rec.status === "missing" || rec.status === "corrupt") {
        if (rec.status === "corrupt") {
          await this.fs.deleteFile(rec.localPath).catch(() => {});
        }
        delete this.manifest.assets[key];
        purgedCount++;
      }
    }

    if (purgedCount > 0) {
      await this.saveManifestAtomic();
    }

    return { purgedCount };
  }
}

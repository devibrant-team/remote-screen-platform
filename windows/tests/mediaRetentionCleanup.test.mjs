// tests/mediaRetentionCleanup.test.mjs
/**
 * Iguana Signage - Media Retention & Storage Cleanup Test Suite (Phase 4)
 *
 * Validates cross-platform media retention and cleanup:
 * 1. Healthy cache retention (assets >= 7 days retained when storage < 90%)
 * 2. Storage pressure trigger & two-tier LRU eviction (>=7d candidates first, then newer)
 * 3. Active playback & reader lease protection (never deleted during streaming)
 * 4. Playlist replacement & automatic protection release (prevents indefinitely pinned obsolete media)
 * 5. Multi-scope protection (current, upcoming, standby default, interactive)
 * 6. Abandoned .part file cleanup & active download safety
 * 7. Orphaned and corrupted file detection & atomic manifest reconciliation
 * 8. Quota overflow with 100% protected media (insufficientStorage reported, no protected media deleted)
 * 9. Diagnostics telemetry accuracy (cacheBytes, quotaBytes, protectedAssets, unprotectedAssets, etc.)
 * 10. Repeated cleanup idempotency & crash recovery
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

console.log("=================================================================");
console.log("  IGUANA SIGNAGE - MEDIA RETENTION & STORAGE CLEANUP TEST SUITE (PHASE 4)");
console.log("=================================================================\n");

function normalizeMediaUrl(url) {
  if (!url) return "";
  return url
    .trim()
    .replace(/([?&])cb=\d+(&|$)/, (_m, p1, p2) => (p2 ? p1 : ""))
    .replace(/\?&$/, "?")
    .replace(/\?$/, "");
}

function generateAssetKey(normalizedUrl) {
  const norm = normalizeMediaUrl(normalizedUrl);
  try {
    const parsed = new URL(norm);
    const basename = path.basename(parsed.pathname).replace(/[^a-zA-Z0-9._-]/g, "_");
    const hash = crypto.createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16);
    return `${basename || "asset"}_${hash}`;
  } catch {
    const hash = crypto.createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16);
    return `asset_${hash}`;
  }
}

const DEFAULT_CLEANUP_CONFIG = {
  retentionMs: 7 * 24 * 60 * 60 * 1000,      // 7 days
  cleanupIntervalMs: 6 * 60 * 60 * 1000,     // 6 hours
  pressureThreshold: 0.90,                   // 90%
  targetUsageRatio: 0.80,                    // 80%
  unpinGracePeriodMs: 60 * 1000,             // 60 seconds
};

class MediaStorageEngineTestImpl {
  constructor(options) {
    this.baseDir = options.baseDir.replace(/[/\\]+$/, "");
    this.quotaBytes = options.quotaBytes ?? 2 * 1024 * 1024 * 1024;
    this.manifestPath = `${this.baseDir}/manifest.json`;
    this.tempManifestPath = `${this.baseDir}/manifest.json.tmp`;
    this.backupManifestPath = `${this.baseDir}/manifest.json.bak`;
    this.config = { ...DEFAULT_CLEANUP_CONFIG, ...(options.cleanupConfig || {}) };
    this.manifest = null;

    this.protectionSources = new Map();
    this.readerLeases = new Map();
    this.unpinTimestamps = new Map();
    this.downloadQueue = null;
    this.lastCleanupAt = null;

    this.diagnostics = {
      cacheBytes: 0,
      quotaBytes: this.quotaBytes,
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
  }

  setDownloadQueue(queue) {
    this.downloadQueue = queue;
  }

  getCleanupConfig() {
    return { ...this.config };
  }

  async reconcileStartup() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    let recoveredFromBackup = false;
    let loaded = this.tryLoadManifest(this.manifestPath);
    if (!loaded) {
      loaded = this.tryLoadManifest(this.backupManifestPath);
      if (loaded) recoveredFromBackup = true;
    }
    if (!loaded) {
      loaded = { version: 1, updatedAt: Date.now(), quotaBytes: this.quotaBytes, assets: {} };
    }
    this.manifest = loaded;
    this.manifest.quotaBytes = this.quotaBytes;
    await this.saveManifestAtomic();
    return { recoveredFromBackup };
  }

  tryLoadManifest(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw || !raw.trim()) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.assets) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  async saveManifestAtomic() {
    if (!this.manifest) return;
    this.manifest.updatedAt = Date.now();
    const content = JSON.stringify(this.manifest, null, 2);
    fs.writeFileSync(this.tempManifestPath, content, "utf8");
    fs.renameSync(this.tempManifestPath, this.manifestPath);
    fs.copyFileSync(this.manifestPath, this.backupManifestPath);
  }

  getManifest() {
    return this.manifest;
  }

  getAsset(urlOrKey) {
    if (!this.manifest) return null;
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    return this.manifest.assets[key] || null;
  }

  async setProtectedAssets(source, urls) {
    const keys = new Set();
    for (const u of urls) {
      const norm = normalizeMediaUrl(u);
      if (norm) keys.add(generateAssetKey(norm));
    }
    if (keys.size === 0) {
      this.protectionSources.delete(source);
    } else {
      this.protectionSources.set(source, keys);
    }

    if (this.manifest) {
      const now = Date.now();
      for (const [key, rec] of Object.entries(this.manifest.assets)) {
        const wasProtected = !!rec.isActive;
        const matching = [];
        for (const [src, kSet] of this.protectionSources.entries()) {
          if (kSet.has(key)) matching.push(src);
        }
        const hasReaders = (this.readerLeases.get(key) || 0) > 0;
        const isNowProtected = matching.length > 0 || hasReaders;

        rec.protectionSources = matching;
        rec.activeReaders = this.readerLeases.get(key) || 0;
        rec.isActive = isNowProtected;

        if (isNowProtected) {
          rec.timestamps.lastAccessedAt = now;
          this.unpinTimestamps.delete(key);
          rec.unpinnedAt = null;
        } else if (wasProtected && !isNowProtected) {
          this.unpinTimestamps.set(key, now);
          rec.unpinnedAt = now;
        }
      }
      await this.saveManifestAtomic();
    }
  }

  acquireReaderLease(urlOrKey) {
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

  releaseReaderLease(urlOrKey) {
    const norm = normalizeMediaUrl(urlOrKey);
    const key = this.manifest?.assets[urlOrKey] ? urlOrKey : generateAssetKey(norm);
    const current = this.readerLeases.get(key) || 0;
    if (current <= 1) {
      this.readerLeases.delete(key);
      let stillProtected = false;
      for (const kSet of this.protectionSources.values()) {
        if (kSet.has(key)) {
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

  isAssetProtected(assetKey) {
    if ((this.readerLeases.get(assetKey) || 0) > 0) return true;
    for (const keys of this.protectionSources.values()) {
      if (keys.has(assetKey)) return true;
    }
    const unpinnedAt = this.unpinTimestamps.get(assetKey);
    if (unpinnedAt && Date.now() - unpinnedAt < this.config.unpinGracePeriodMs) {
      return true;
    }
    if (this.downloadQueue?.isAssetActive?.(assetKey)) return true;
    if (this.manifest?.assets[assetKey]?.isActive) return true;
    return false;
  }

  async performCleanup(options = {}) {
    if (!this.manifest) await this.reconcileStartup();

    const now = Date.now();
    let reclaimedBytes = 0;
    let deletedAssets = 0;
    let failedDeletions = 0;
    let orphansCleaned = 0;
    let abandonedPartsCleaned = 0;

    // 1. Clean abandoned .part files (Rule 7)
    const diskFiles = fs.readdirSync(this.baseDir);
    for (const file of diskFiles) {
      if (file.endsWith(".part")) {
        const fullPartPath = path.join(this.baseDir, file);
        const isActiveDownload = this.downloadQueue?.isPartFileActive?.(file);
        if (!isActiveDownload) {
          const stat = fs.statSync(fullPartPath);
          const isRecent = stat.mtimeMs && now - stat.mtimeMs < 5 * 60 * 1000;
          if (!isRecent || options.reason === "startup") {
            try {
              fs.unlinkSync(fullPartPath);
              abandonedPartsCleaned++;
            } catch {
              failedDeletions++;
            }
          }
        }
      }
    }

    // 2. Clean orphaned files (Rule 8)
    const manifestPaths = new Set(
      Object.values(this.manifest.assets).map((a) => path.resolve(a.localPath))
    );
    for (const file of diskFiles) {
      const fullPath = path.resolve(path.join(this.baseDir, file));
      if (
        !file.endsWith(".json") &&
        !file.endsWith(".bak") &&
        !file.endsWith(".tmp") &&
        !file.endsWith(".part") &&
        !manifestPaths.has(fullPath)
      ) {
        try {
          fs.unlinkSync(fullPath);
          orphansCleaned++;
        } catch {
          failedDeletions++;
        }
      }
    }

    // 3. Reconcile manifest entries & calculate total used bytes
    let totalUsedBytes = 0;
    const completedAssets = [];

    for (const [key, record] of Object.entries(this.manifest.assets)) {
      if (record.status === "completed") {
        if (!fs.existsSync(record.localPath)) {
          record.status = "missing";
        } else {
          const stat = fs.statSync(record.localPath);
          if (stat.size === 0 || (record.sizeBytes > 0 && stat.size !== record.sizeBytes)) {
            record.status = "corrupt";
            try { fs.unlinkSync(record.localPath); } catch {}
          } else {
            totalUsedBytes += record.sizeBytes || stat.size;
            completedAssets.push(record);
          }
        }
      }
    }

    // Purge missing/corrupt records
    for (const [key, record] of Object.entries(this.manifest.assets)) {
      if (record.status === "missing" || record.status === "corrupt") {
        delete this.manifest.assets[key];
      }
    }

    // 4. Pressure & Eviction Evaluation
    const quotaBytes = this.manifest.quotaBytes;
    const pressureThresholdBytes = quotaBytes * this.config.pressureThreshold;
    const targetLimitBytes = Math.min(
      quotaBytes * this.config.targetUsageRatio,
      options.requiredBytes ? Math.max(0, quotaBytes - options.requiredBytes) : quotaBytes * this.config.targetUsageRatio
    );

    const isPressure =
      totalUsedBytes > pressureThresholdBytes ||
      (options.requiredBytes != null && totalUsedBytes + options.requiredBytes > quotaBytes);
    const isQuotaExceeded = totalUsedBytes > quotaBytes;
    const shouldEvict = isPressure || isQuotaExceeded || options.force;

    let insufficientStorage = false;

    if (shouldEvict && totalUsedBytes > targetLimitBytes) {
      // Filter candidates: strictly UNPROTECTED assets
      const candidates = completedAssets.filter((rec) => !this.isAssetProtected(rec.assetKey));

      const tier1 = [];
      const tier2 = [];

      for (const rec of candidates) {
        const lastAccess = rec.timestamps.lastAccessedAt || rec.timestamps.createdAt || 0;
        if (now - lastAccess >= this.config.retentionMs) {
          tier1.push(rec);
        } else {
          tier2.push(rec);
        }
      }

      tier1.sort((a, b) => (a.timestamps.lastAccessedAt || 0) - (b.timestamps.lastAccessedAt || 0));
      tier2.sort((a, b) => (a.timestamps.lastAccessedAt || 0) - (b.timestamps.lastAccessedAt || 0));

      const evictionQueue = [...tier1, ...tier2];

      for (const rec of evictionQueue) {
        if (totalUsedBytes <= targetLimitBytes) break;
        try {
          fs.unlinkSync(rec.localPath);
          totalUsedBytes -= rec.sizeBytes || 0;
          reclaimedBytes += rec.sizeBytes || 0;
          deletedAssets++;
          delete this.manifest.assets[rec.assetKey];
        } catch {
          failedDeletions++;
        }
      }

      if (totalUsedBytes > quotaBytes || (options.requiredBytes && totalUsedBytes + options.requiredBytes > quotaBytes)) {
        insufficientStorage = true;
      }
    }

    this.lastCleanupAt = now;

    let protectedCount = 0;
    let unprotectedCount = 0;
    for (const [key, rec] of Object.entries(this.manifest.assets)) {
      if (rec.status === "completed") {
        if (this.isAssetProtected(key)) protectedCount++;
        else unprotectedCount++;
      }
    }

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

  getCleanupDiagnostics() {
    return { ...this.diagnostics };
  }
}

async function runAllTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iguana-cleanup-test-"));

  try {
    // ---------------------------------------------------------
    // Scenario 1: Healthy Cache Retention (Rule 6)
    // ---------------------------------------------------------
    console.log("Scenario 1: Healthy Cache Retention (Rule 6)...");
    {
      const baseDir = path.join(tmpRoot, "s1_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 10 * 1024 * 1024,
        cleanupConfig: {
          retentionMs: 7 * 24 * 60 * 60 * 1000,
          pressureThreshold: 0.90,
          unpinGracePeriodMs: 0,
        },
      });
      await storage.reconcileStartup();

      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const url = "https://cdn.example.com/promo_old.mp4";
      const key = generateAssetKey(url);
      const filePath = path.join(baseDir, `${key}.mp4`);
      fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024));

      storage.getManifest().assets[key] = {
        url,
        assetKey: key,
        localPath: filePath,
        sizeBytes: 1024 * 1024,
        validation: { verifiedAt: tenDaysAgo },
        status: "completed",
        timestamps: { createdAt: tenDaysAgo, updatedAt: tenDaysAgo, lastAccessedAt: tenDaysAgo },
        isActive: false,
      };
      await storage.saveManifestAtomic();

      const cleanupResult = await storage.performCleanup({ reason: "periodic" });

      assert.equal(cleanupResult.deletedAssets, 0, "Healthy cache should not evict media solely due to age");
      assert.ok(fs.existsSync(filePath), "Old media file must remain on disk while storage is healthy");
      assert.ok(storage.getAsset(url), "Asset must remain in manifest");

      console.log("  PASS: Media older than 7 days is safely retained when storage pressure is below 90%.");
    }

    // ---------------------------------------------------------
    // Scenario 2: Storage Pressure Trigger & Two-Tier LRU Eviction (Rule 5)
    // ---------------------------------------------------------
    console.log("Scenario 2: Storage Pressure Trigger & Two-Tier LRU Eviction (Rule 5)...");
    {
      const baseDir = path.join(tmpRoot, "s2_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 1000,
        cleanupConfig: {
          retentionMs: 7 * 24 * 60 * 60 * 1000,
          pressureThreshold: 0.90,
          targetUsageRatio: 0.70,
          unpinGracePeriodMs: 0,
        },
      });
      await storage.reconcileStartup();

      const now = Date.now();
      const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
      const oneHourAgo = now - 1 * 60 * 60 * 1000;

      const urlA = "https://cdn.example.com/assetA.mp4";
      const keyA = generateAssetKey(urlA);
      const pathA = path.join(baseDir, `${keyA}.mp4`);
      fs.writeFileSync(pathA, Buffer.alloc(200));
      storage.getManifest().assets[keyA] = {
        url: urlA,
        assetKey: keyA,
        localPath: pathA,
        sizeBytes: 200,
        status: "completed",
        timestamps: { createdAt: tenDaysAgo, updatedAt: tenDaysAgo, lastAccessedAt: tenDaysAgo },
        isActive: false,
        validation: {},
      };

      const urlB = "https://cdn.example.com/assetB.mp4";
      const keyB = generateAssetKey(urlB);
      const pathB = path.join(baseDir, `${keyB}.mp4`);
      fs.writeFileSync(pathB, Buffer.alloc(200));
      storage.getManifest().assets[keyB] = {
        url: urlB,
        assetKey: keyB,
        localPath: pathB,
        sizeBytes: 200,
        status: "completed",
        timestamps: { createdAt: tenDaysAgo + 1000, updatedAt: tenDaysAgo + 1000, lastAccessedAt: tenDaysAgo + 1000 },
        isActive: false,
        validation: {},
      };

      const urlC = "https://cdn.example.com/assetC.mp4";
      const keyC = generateAssetKey(urlC);
      const pathC = path.join(baseDir, `${keyC}.mp4`);
      fs.writeFileSync(pathC, Buffer.alloc(300));
      storage.getManifest().assets[keyC] = {
        url: urlC,
        assetKey: keyC,
        localPath: pathC,
        sizeBytes: 300,
        status: "completed",
        timestamps: { createdAt: twoDaysAgo, updatedAt: twoDaysAgo, lastAccessedAt: twoDaysAgo },
        isActive: false,
        validation: {},
      };

      const urlD = "https://cdn.example.com/assetD.mp4";
      const keyD = generateAssetKey(urlD);
      const pathD = path.join(baseDir, `${keyD}.mp4`);
      fs.writeFileSync(pathD, Buffer.alloc(300));
      storage.getManifest().assets[keyD] = {
        url: urlD,
        assetKey: keyD,
        localPath: pathD,
        sizeBytes: 300,
        status: "completed",
        timestamps: { createdAt: oneHourAgo, updatedAt: oneHourAgo, lastAccessedAt: oneHourAgo },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();

      const result = await storage.performCleanup({ reason: "pressure" });

      assert.equal(result.pressureDetected, true);
      assert.equal(result.deletedAssets, 2);
      assert.equal(result.reclaimedBytes, 400);

      assert.equal(fs.existsSync(pathA), false, "Oldest Tier 1 asset A must be evicted first");
      assert.equal(fs.existsSync(pathB), false, "Tier 1 asset B must be evicted second");
      assert.equal(fs.existsSync(pathC), true, "Tier 2 asset C should be preserved when target reached");
      assert.equal(fs.existsSync(pathD), true, "Tier 2 asset D should be preserved when target reached");

      console.log("  PASS: Under quota pressure, Tier 1 assets (>= 7 days) evicted first; newer assets preserved.");
    }

    // ---------------------------------------------------------
    // Scenario 3: Active Playback & Reader Lease Protection (Rule 3 & 9)
    // ---------------------------------------------------------
    console.log("Scenario 3: Active Playback & Reader Lease Protection (Rule 3 & 9)...");
    {
      const baseDir = path.join(tmpRoot, "s3_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 500,
        cleanupConfig: {
          retentionMs: 0,
          pressureThreshold: 0.50,
          targetUsageRatio: 0.20,
          unpinGracePeriodMs: 60 * 1000,
        },
      });
      await storage.reconcileStartup();

      const url1 = "https://cdn.example.com/unprotected.mp4";
      const key1 = generateAssetKey(url1);
      const path1 = path.join(baseDir, `${key1}.mp4`);
      fs.writeFileSync(path1, Buffer.alloc(300));
      storage.getManifest().assets[key1] = {
        url: url1,
        assetKey: key1,
        localPath: path1,
        sizeBytes: 300,
        status: "completed",
        timestamps: { createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000, lastAccessedAt: Date.now() - 5000 },
        isActive: false,
        validation: {},
      };

      const url2 = "https://cdn.example.com/streaming_video.mp4";
      const key2 = generateAssetKey(url2);
      const path2 = path.join(baseDir, `${key2}.mp4`);
      fs.writeFileSync(path2, Buffer.alloc(300));
      storage.getManifest().assets[key2] = {
        url: url2,
        assetKey: key2,
        localPath: path2,
        sizeBytes: 300,
        status: "completed",
        timestamps: { createdAt: Date.now() - 10000, updatedAt: Date.now() - 10000, lastAccessedAt: Date.now() - 10000 },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();

      const releaseLease = storage.acquireReaderLease(key2);
      assert.equal(storage.isAssetProtected(key2), true, "Asset with active reader lease must be protected");

      await storage.performCleanup({ force: true, reason: "pressure" });

      assert.equal(fs.existsSync(path1), false, "Unprotected asset should be evicted");
      assert.equal(fs.existsSync(path2), true, "Asset with active reader lease must NEVER be evicted!");

      releaseLease();
      assert.equal(storage.isAssetProtected(key2), true, "Asset in unpin grace period must still be protected");

      await storage.performCleanup({ force: true, reason: "pressure" });
      assert.equal(fs.existsSync(path2), true, "Asset in grace period must not be evicted immediately after slide inactive");

      console.log("  PASS: Active reader leases and unpin grace periods strictly shield streaming media from eviction.");
    }

    // ---------------------------------------------------------
    // Scenario 4: Playlist Replacement & Automatic Protection Release (Rule 4)
    // ---------------------------------------------------------
    console.log("Scenario 4: Playlist Replacement & Protection Release (Rule 4)...");
    {
      const baseDir = path.join(tmpRoot, "s4_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 1000,
        cleanupConfig: {
          retentionMs: 0,
          pressureThreshold: 0.50,
          targetUsageRatio: 0.20,
          unpinGracePeriodMs: 0,
        },
      });
      await storage.reconcileStartup();

      const urlA = "https://cdn.example.com/playlistA_video.mp4";
      const keyA = generateAssetKey(urlA);
      const pathA = path.join(baseDir, `${keyA}.mp4`);
      fs.writeFileSync(pathA, Buffer.alloc(400));
      storage.getManifest().assets[keyA] = {
        url: urlA,
        assetKey: keyA,
        localPath: pathA,
        sizeBytes: 400,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };

      const urlB = "https://cdn.example.com/playlistB_video.mp4";
      const keyB = generateAssetKey(urlB);
      const pathB = path.join(baseDir, `${keyB}.mp4`);
      fs.writeFileSync(pathB, Buffer.alloc(400));
      storage.getManifest().assets[keyB] = {
        url: urlB,
        assetKey: keyB,
        localPath: pathB,
        sizeBytes: 400,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();

      await storage.setProtectedAssets("current_playlist", [urlA]);
      assert.equal(storage.isAssetProtected(keyA), true, "Asset A must be protected when Playlist A is active");
      assert.equal(storage.isAssetProtected(keyB), false, "Asset B is unprotected");

      await storage.setProtectedAssets("current_playlist", [urlB]);
      assert.equal(storage.isAssetProtected(keyB), true, "Asset B must now be protected");
      assert.equal(storage.isAssetProtected(keyA), false, "Asset A protection must be released when replaced");

      await storage.performCleanup({ force: true, reason: "pressure" });
      assert.equal(fs.existsSync(pathA), false, "Replaced playlist asset must be eligible for eviction");
      assert.equal(fs.existsSync(pathB), true, "Active playlist asset must be preserved");

      console.log("  PASS: Protection is cleanly released when playlists transition; obsolete media never stuck pinned.");
    }

    // ---------------------------------------------------------
    // Scenario 5: Multi-Scope Protection (Current + Upcoming + Standby Default)
    // ---------------------------------------------------------
    console.log("Scenario 5: Multi-Scope Protection (Current, Upcoming, Standby Default)...");
    {
      const baseDir = path.join(tmpRoot, "s5_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 1500,
        cleanupConfig: { unpinGracePeriodMs: 0 },
      });
      await storage.reconcileStartup();

      const urlCurrent = "https://cdn.example.com/current_slot.mp4";
      const urlUpcoming = "https://cdn.example.com/upcoming_scheduled.mp4";
      const urlDefault = "https://cdn.example.com/standby_default.mp4";
      const urlOld = "https://cdn.example.com/old_abandoned.mp4";

      const keyCurrent = generateAssetKey(urlCurrent);
      const keyUpcoming = generateAssetKey(urlUpcoming);
      const keyDefault = generateAssetKey(urlDefault);
      const keyOld = generateAssetKey(urlOld);

      for (const [k, u] of [[keyCurrent, urlCurrent], [keyUpcoming, urlUpcoming], [keyDefault, urlDefault], [keyOld, urlOld]]) {
        const p = path.join(baseDir, `${k}.mp4`);
        fs.writeFileSync(p, Buffer.alloc(400));
        storage.getManifest().assets[k] = {
          url: u,
          assetKey: k,
          localPath: p,
          sizeBytes: 400,
          status: "completed",
          timestamps: { createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000, lastAccessedAt: Date.now() - 5000 },
          isActive: false,
          validation: {},
        };
      }
      await storage.saveManifestAtomic();

      await storage.setProtectedAssets("current_playlist", [urlCurrent]);
      await storage.setProtectedAssets("upcoming_playlist", [urlUpcoming]);
      await storage.setProtectedAssets("default_playlist", [urlDefault]);

      assert.equal(storage.isAssetProtected(keyCurrent), true, "Current playlist media protected");
      assert.equal(storage.isAssetProtected(keyUpcoming), true, "Upcoming scheduled media protected");
      assert.equal(storage.isAssetProtected(keyDefault), true, "Standby default playlist media protected");
      assert.equal(storage.isAssetProtected(keyOld), false, "Old media unprotected");

      const res = await storage.performCleanup({ force: true, reason: "pressure" });
      assert.equal(res.deletedAssets, 1);
      assert.equal(fs.existsSync(path.join(baseDir, `${keyOld}.mp4`)), false, "Old asset evicted");
      assert.equal(fs.existsSync(path.join(baseDir, `${keyCurrent}.mp4`)), true, "Current preserved");
      assert.equal(fs.existsSync(path.join(baseDir, `${keyUpcoming}.mp4`)), true, "Upcoming preserved");
      assert.equal(fs.existsSync(path.join(baseDir, `${keyDefault}.mp4`)), true, "Default preserved");

      console.log("  PASS: Current, upcoming schedule, and standby default playlist media all concurrently protected.");
    }

    // ---------------------------------------------------------
    // Scenario 6: Abandoned .part File Cleanup & Active Download Safety (Rule 7)
    // ---------------------------------------------------------
    console.log("Scenario 6: Abandoned .part File Cleanup & Active Download Safety (Rule 7)...");
    {
      const baseDir = path.join(tmpRoot, "s6_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 10 * 1024 * 1024,
      });
      await storage.reconcileStartup();

      const activeTaskKey = "active_download_key_12345";
      const activePartFile = `${activeTaskKey}.media.part`;
      const activePartPath = path.join(baseDir, activePartFile);
      fs.writeFileSync(activePartPath, Buffer.from("IN_FLIGHT_CHUNK_DATA"));

      const abandonedKey = "crashed_old_download_99999";
      const abandonedPartFile = `${abandonedKey}.media.part`;
      const abandonedPartPath = path.join(baseDir, abandonedPartFile);
      fs.writeFileSync(abandonedPartPath, Buffer.from("ABANDONED_CORRUPT_DATA"));
      const oneHourAgo = (Date.now() - 3600 * 1000) / 1000;
      fs.utimesSync(abandonedPartPath, oneHourAgo, oneHourAgo);

      storage.setDownloadQueue({
        isAssetActive: (key) => key === activeTaskKey,
        isPartFileActive: (filename) => filename.includes(activeTaskKey),
      });

      const res = await storage.performCleanup({ reason: "periodic" });

      assert.equal(fs.existsSync(activePartPath), true, "In-flight download .part file must never be deleted!");
      assert.equal(fs.existsSync(abandonedPartPath), false, "Abandoned .part file must be cleaned up");
      assert.equal(res.abandonedPartsCleaned, 1);

      console.log("  PASS: Abandoned .part files cleaned safely while in-flight downloads are strictly preserved.");
    }

    // ---------------------------------------------------------
    // Scenario 7: Orphaned and Corrupted File Detection & Atomic Reconciliation (Rule 8)
    // ---------------------------------------------------------
    console.log("Scenario 7: Orphaned and Corrupted File Detection & Atomic Reconciliation (Rule 8)...");
    {
      const baseDir = path.join(tmpRoot, "s7_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 10 * 1024 * 1024,
      });
      await storage.reconcileStartup();

      const orphanPath = path.join(baseDir, "rogue_external_file.mp4");
      fs.writeFileSync(orphanPath, Buffer.from("ORPHAN_DATA"));

      const corruptUrl = "https://cdn.example.com/corrupt_zero.mp4";
      const corruptKey = generateAssetKey(corruptUrl);
      const corruptPath = path.join(baseDir, `${corruptKey}.mp4`);
      fs.writeFileSync(corruptPath, "");
      storage.getManifest().assets[corruptKey] = {
        url: corruptUrl,
        assetKey: corruptKey,
        localPath: corruptPath,
        sizeBytes: 1024,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };

      const missingUrl = "https://cdn.example.com/ghost_file.mp4";
      const missingKey = generateAssetKey(missingUrl);
      storage.getManifest().assets[missingKey] = {
        url: missingUrl,
        assetKey: missingKey,
        localPath: path.join(baseDir, `${missingKey}.mp4`),
        sizeBytes: 2048,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();

      const res = await storage.performCleanup({ reason: "periodic" });

      assert.equal(res.orphansCleaned, 1, "Orphan file must be cleaned");
      assert.equal(fs.existsSync(orphanPath), false, "Orphan file must be removed from disk");
      assert.equal(fs.existsSync(corruptPath), false, "Corrupt 0-byte file must be removed from disk");
      assert.equal(storage.getAsset(missingUrl), null, "Missing entry must be purged from manifest");
      assert.equal(storage.getAsset(corruptUrl), null, "Corrupt entry must be purged from manifest");

      console.log("  PASS: Orphaned, 0-byte, and missing files detected and reconciled atomically.");
    }

    // ---------------------------------------------------------
    // Scenario 8: Quota Overflow with 100% Protected Media (Rule 11)
    // ---------------------------------------------------------
    console.log("Scenario 8: Quota Overflow with 100% Protected Media (Rule 11)...");
    {
      const baseDir = path.join(tmpRoot, "s8_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 500,
      });
      await storage.reconcileStartup();

      const url1 = "https://cdn.example.com/active_video_1.mp4";
      const url2 = "https://cdn.example.com/active_video_2.mp4";
      const key1 = generateAssetKey(url1);
      const key2 = generateAssetKey(url2);
      const path1 = path.join(baseDir, `${key1}.mp4`);
      const path2 = path.join(baseDir, `${key2}.mp4`);
      fs.writeFileSync(path1, Buffer.alloc(400));
      fs.writeFileSync(path2, Buffer.alloc(400));

      storage.getManifest().assets[key1] = {
        url: url1,
        assetKey: key1,
        localPath: path1,
        sizeBytes: 400,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: true,
        validation: {},
      };
      storage.getManifest().assets[key2] = {
        url: url2,
        assetKey: key2,
        localPath: path2,
        sizeBytes: 400,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: true,
        validation: {},
      };
      await storage.saveManifestAtomic();
      await storage.setProtectedAssets("current_playlist", [url1, url2]);

      const res = await storage.performCleanup({ force: true, reason: "pressure" });

      assert.equal(res.insufficientStorage, true, "Must report insufficientStorage when quota exceeded by protected media");
      assert.equal(res.deletedAssets, 0, "NEVER delete protected media even under quota overflow!");
      assert.equal(fs.existsSync(path1), true, "Protected video 1 must remain intact");
      assert.equal(fs.existsSync(path2), true, "Protected video 2 must remain intact");

      console.log("  PASS: Protected media is never evicted even when exceeding quota; insufficient storage reported.");
    }

    // ---------------------------------------------------------
    // Scenario 9: Diagnostics Telemetry Accuracy (Rule 12)
    // ---------------------------------------------------------
    console.log("Scenario 9: Diagnostics Telemetry Accuracy (Rule 12)...");
    {
      const baseDir = path.join(tmpRoot, "s9_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 2000,
      });
      await storage.reconcileStartup();

      const urlProt = "https://cdn.example.com/diag_prot.mp4";
      const urlUnprot = "https://cdn.example.com/diag_unprot.mp4";
      const keyProt = generateAssetKey(urlProt);
      const keyUnprot = generateAssetKey(urlUnprot);

      fs.writeFileSync(path.join(baseDir, `${keyProt}.mp4`), Buffer.alloc(500));
      fs.writeFileSync(path.join(baseDir, `${keyUnprot}.mp4`), Buffer.alloc(300));

      storage.getManifest().assets[keyProt] = {
        url: urlProt,
        assetKey: keyProt,
        localPath: path.join(baseDir, `${keyProt}.mp4`),
        sizeBytes: 500,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: true,
        validation: {},
      };
      storage.getManifest().assets[keyUnprot] = {
        url: urlUnprot,
        assetKey: keyUnprot,
        localPath: path.join(baseDir, `${keyUnprot}.mp4`),
        sizeBytes: 300,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();
      await storage.setProtectedAssets("current_playlist", [urlProt]);

      await storage.performCleanup({ reason: "periodic" });
      const diag = storage.getCleanupDiagnostics();

      assert.equal(typeof diag.cacheBytes, "number", "cacheBytes must be number");
      assert.equal(diag.cacheBytes, 800, "cacheBytes must match actual disk size (500 + 300)");
      assert.equal(diag.quotaBytes, 2000, "quotaBytes must match configured quota");
      assert.equal(diag.protectedAssets, 1, "protectedAssets count must be 1");
      assert.equal(diag.unprotectedAssets, 1, "unprotectedAssets count must be 1");
      assert.equal(typeof diag.reclaimedBytes, "number", "reclaimedBytes must be number");
      assert.equal(typeof diag.deletedAssets, "number", "deletedAssets must be number");
      assert.equal(typeof diag.failedDeletions, "number", "failedDeletions must be number");
      assert.ok(diag.lastCleanupAt > 0, "lastCleanupAt must be valid timestamp");

      console.log("  PASS: All 8 diagnostics fields accurately report cache and cleanup telemetry.");
    }

    // ---------------------------------------------------------
    // Scenario 10: Repeated Cleanup Idempotency & Crash Recovery
    // ---------------------------------------------------------
    console.log("Scenario 10: Repeated Cleanup Idempotency & Crash Recovery...");
    {
      const baseDir = path.join(tmpRoot, "s10_media");
      const storage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 5000,
      });
      await storage.reconcileStartup();

      const url = "https://cdn.example.com/idem.mp4";
      const key = generateAssetKey(url);
      const filePath = path.join(baseDir, `${key}.mp4`);
      fs.writeFileSync(filePath, Buffer.alloc(1000));
      storage.getManifest().assets[key] = {
        url,
        assetKey: key,
        localPath: filePath,
        sizeBytes: 1000,
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
        isActive: false,
        validation: {},
      };
      await storage.saveManifestAtomic();

      for (let i = 0; i < 5; i++) {
        const res = await storage.performCleanup({ reason: "periodic" });
        assert.equal(res.failedDeletions, 0);
      }
      assert.equal(fs.existsSync(filePath), true, "Healthy file must survive repeated cleanups");

      const manifestPath = path.join(baseDir, "manifest.json");
      const backupPath = path.join(baseDir, "manifest.json.bak");
      fs.copyFileSync(manifestPath, backupPath);
      fs.writeFileSync(manifestPath, "MALFORMED_JSON_CRASH_CONTENT");

      const recoveredStorage = new MediaStorageEngineTestImpl({
        baseDir,
        quotaBytes: 5000,
      });
      const rep = await recoveredStorage.reconcileStartup();
      assert.equal(rep.recoveredFromBackup, true, "Must recover manifest from .bak after simulated crash");
      assert.ok(recoveredStorage.getAsset(url), "Asset restored from crash backup");

      console.log("  PASS: Repeated cleanups are strictly idempotent; manifest recovers safely from crash.");
    }

    console.log("\n=================================================================");
    console.log("  ALL 10 MEDIA RETENTION & STORAGE CLEANUP SCENARIOS PASSED!");
    console.log("=================================================================\n");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runAllTests().catch((err) => {
  console.error("\n❌ Media Retention & Storage Cleanup Test Suite Failed:", err);
  process.exit(1);
});

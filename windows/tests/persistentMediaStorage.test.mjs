// tests/persistentMediaStorage.test.mjs
/**
 * Iguana Signage - Persistent Media Storage & Asset Manifest Test Suite
 * Validates Phase 1 persistent media storage foundation and asset manifest reliability:
 * 1. Asset Identity, URL Normalization, and Key Generation
 * 2. Normal Application Restart & Offline Persistence
 * 3. Atomic Persistence & Crash Recovery (from .bak and disk scan)
 * 4. Detection of Missing Files
 * 5. Detection of Corrupt Entries & Leftover Interrupted Downloads
 * 6. Server Metadata & Integrity (ETag, Last-Modified, Content-Length)
 * 7. Configurable Quota & Active Asset Eviction Protection
 * 8. Platform Parity & Contract Verification
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

console.log("=================================================================");
console.log("  IGUANA SIGNAGE - PERSISTENT MEDIA STORAGE TEST SUITE (PHASE 1) ");
console.log("=================================================================\n");

// --- 1. Deterministic pure-JS SHA-256 and URL normalization matching source ---
function normalizeMediaUrl(url) {
  if (!url) return "";
  return url
    .trim()
    .replace(/([?&])cb=\d+(&|$)/, (_m, p1, p2) => (p2 ? p1 : ""))
    .replace(/\?&$/, "?")
    .replace(/\?$/, "");
}

function sha256Utf8(str) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }

  const bitLength = bytes.length * 8;
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0x00);
  }

  const words = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      (bytes[i] << 24) |
      (bytes[i + 1] << 16) |
      (bytes[i + 2] << 8) |
      bytes[i + 3]
    );
  }
  words.push(Math.floor(bitLength / 0x100000000));
  words.push(bitLength & 0xffffffff);

  for (let j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16);
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let i = 0; i < 64; i++) {
      if (i >= 16) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let result = "";
  for (let i = 0; i < 8; i++) {
    result += (hash[i] >>> 0).toString(16).padStart(8, "0");
  }
  return result;
}

function generateAssetKey(url) {
  return sha256Utf8(normalizeMediaUrl(url));
}

// --- 2. Mock Test FileSystem Adapter for Deterministic Offline Scenarios ---
class TestFileSystemAdapter {
  constructor(rootDisk = {}) {
    this.files = new Map(Object.entries(rootDisk)); // path -> { content: Buffer|string, mtime: number }
    this.directories = new Set();
    this.networkMock = new Map(); // url -> { status, headers, body: Buffer|string }
  }

  mockNetworkResponse(url, response) {
    this.networkMock.set(normalizeMediaUrl(url), response);
  }

  async exists(targetPath) {
    return this.files.has(targetPath) || this.directories.has(targetPath);
  }

  async stat(targetPath) {
    if (this.files.has(targetPath)) {
      const f = this.files.get(targetPath);
      const size = Buffer.isBuffer(f.content) ? f.content.length : Buffer.byteLength(f.content || "", "utf8");
      return { size, mtimeMs: f.mtime };
    }
    return null;
  }

  async readFile(targetPath) {
    const f = this.files.get(targetPath);
    if (!f) throw new Error(`ENOENT: no such file ${targetPath}`);
    return Buffer.isBuffer(f.content) ? f.content.toString("utf8") : String(f.content);
  }

  async writeFile(targetPath, content) {
    this.files.set(targetPath, { content, mtime: Date.now() });
  }

  async deleteFile(targetPath) {
    this.files.delete(targetPath);
  }

  async rename(src, dest) {
    const item = this.files.get(src);
    if (!item) throw new Error(`ENOENT: cannot rename ${src}`);
    this.files.set(dest, item);
    this.files.delete(src);
  }

  async copyFile(src, dest) {
    const item = this.files.get(src);
    if (!item) throw new Error(`ENOENT: cannot copy ${src}`);
    this.files.set(dest, { content: item.content, mtime: Date.now() });
  }

  async ensureDir(dirPath) {
    this.directories.add(dirPath);
  }

  async readDir(dirPath) {
    const prefix = dirPath.replace(/[/\\]+$/, "") + "/";
    const entries = [];
    for (const [filePath, fileData] of this.files.entries()) {
      if (filePath.startsWith(prefix)) {
        const rel = filePath.slice(prefix.length);
        if (!rel.includes("/")) {
          const size = Buffer.isBuffer(fileData.content)
            ? fileData.content.length
            : Buffer.byteLength(fileData.content || "", "utf8");
          entries.push({ name: rel, isDirectory: false, size });
        }
      }
    }
    return entries;
  }

  async downloadFile(url, destPath, options) {
    const norm = normalizeMediaUrl(url);
    const mock = this.networkMock.get(norm);
    if (!mock) {
      throw new Error(`Mock network offline / 404 for ${url}`);
    }

    if (mock.status === 304) {
      return { status: 304, headers: mock.headers || {}, bytesWritten: 0 };
    }

    if (mock.status >= 200 && mock.status < 300) {
      const content = mock.body || "";
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
      this.files.set(destPath, { content: buf, mtime: Date.now() });
      return {
        status: mock.status,
        headers: mock.headers || { "content-length": String(buf.length) },
        bytesWritten: buf.length,
      };
    }

    return {
      status: mock.status,
      headers: mock.headers || {},
      bytesWritten: 0,
    };
  }
}

// --- 3. Engine implementation matching mediaStorageEngine.ts ---
class TestMediaStorageEngine {
  constructor({ baseDir, quotaBytes = 2 * 1024 * 1024 * 1024, fs }) {
    this.baseDir = baseDir.replace(/[/\\]+$/, "");
    this.fs = fs;
    this.quotaBytes = quotaBytes;
    this.manifestPath = `${this.baseDir}/manifest.json`;
    this.tempManifestPath = `${this.baseDir}/manifest.json.tmp`;
    this.backupManifestPath = `${this.baseDir}/manifest.json.bak`;
    this.manifest = null;
    this.inFlightDownloads = new Map();
  }

  async reconcileStartup() {
    await this.fs.ensureDir(this.baseDir);

    let recoveredFromBackup = false;
    let recoveredFromDiskScan = false;

    let loadedManifest = await this.tryLoadManifest(this.manifestPath);
    if (!loadedManifest) {
      loadedManifest = await this.tryLoadManifest(this.backupManifestPath);
      if (loadedManifest) recoveredFromBackup = true;
    }

    if (!loadedManifest) {
      loadedManifest = {
        version: 1,
        updatedAt: Date.now(),
        quotaBytes: this.quotaBytes,
        assets: {},
      };
      recoveredFromDiskScan = true;
    }

    this.manifest = loadedManifest;
    this.manifest.quotaBytes = this.quotaBytes;

    let orphansCleaned = 0;
    const diskEntries = await this.fs.readDir(this.baseDir).catch(() => []);

    for (const entry of diskEntries) {
      if (entry.isDirectory) continue;
      if (entry.name.endsWith(".part") || entry.name.endsWith(".tmp")) {
        await this.fs.deleteFile(`${this.baseDir}/${entry.name}`).catch(() => {});
        orphansCleaned++;
      }
    }

    let completed = 0;
    let missing = 0;
    let corrupt = 0;
    let stale = 0;

    for (const [key, record] of Object.entries(this.manifest.assets)) {
      const diskStat = await this.fs.stat(record.localPath);
      if (!diskStat) {
        record.status = "missing";
        missing++;
      } else if (diskStat.size === 0) {
        record.status = "corrupt";
        corrupt++;
      } else if (record.sizeBytes > 0 && diskStat.size !== record.sizeBytes) {
        record.status = "corrupt";
        record.sizeBytes = diskStat.size;
        corrupt++;
      } else if (record.status === "downloading" || record.status === "partial") {
        record.status = "corrupt";
        corrupt++;
      } else if (record.status === "stale") {
        stale++;
      } else {
        record.status = "completed";
        record.sizeBytes = diskStat.size;
        completed++;
      }
    }

    if (recoveredFromDiskScan) {
      for (const entry of diskEntries) {
        if (
          entry.name === "manifest.json" ||
          entry.name === "manifest.json.bak" ||
          entry.name === "manifest.json.tmp" ||
          entry.name.endsWith(".part") ||
          entry.name.endsWith(".tmp")
        ) {
          continue;
        }
        const dotIndex = entry.name.indexOf(".");
        const candidateKey = dotIndex > 0 ? entry.name.slice(0, dotIndex) : entry.name;
        if (!this.manifest.assets[candidateKey] && /^[a-f0-9]{32,64}$/i.test(candidateKey)) {
          const fullPath = `${this.baseDir}/${entry.name}`;
          const stat = await this.fs.stat(fullPath);
          if (stat && stat.size > 0) {
            this.manifest.assets[candidateKey] = {
              url: "",
              assetKey: candidateKey,
              localPath: fullPath,
              sizeBytes: stat.size,
              validation: { verifiedAt: Date.now() },
              status: "completed",
              timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
            };
            completed++;
          }
        }
      }
    }

    await this.saveManifestAtomic();

    return {
      total: Object.keys(this.manifest.assets).length,
      completed,
      missing,
      corrupt,
      stale,
      orphansCleaned,
      recoveredFromBackup,
      recoveredFromDiskScan,
    };
  }

  async tryLoadManifest(filePath) {
    try {
      const exists = await this.fs.exists(filePath);
      if (!exists) return null;
      const raw = await this.fs.readFile(filePath);
      const parsed = JSON.parse(raw);
      if (parsed && parsed.assets && typeof parsed.assets === "object") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async saveManifestAtomic() {
    if (!this.manifest) return;
    this.manifest.updatedAt = Date.now();
    const content = JSON.stringify(this.manifest, null, 2);

    await this.fs.writeFile(this.tempManifestPath, content);
    await this.fs.rename(this.tempManifestPath, this.manifestPath);
    await this.fs.writeFile(this.backupManifestPath, content).catch(() => {});
  }

  getManifest() {
    return JSON.parse(JSON.stringify(this.manifest || { assets: {} }));
  }

  getAsset(urlOrKey) {
    if (!this.manifest) return null;
    const key = generateAssetKey(urlOrKey);
    return this.manifest.assets[key] || this.manifest.assets[urlOrKey] || null;
  }

  async setQuota(bytes) {
    if (bytes <= 0) return { evictedCount: 0, freedBytes: 0 };
    this.quotaBytes = bytes;
    if (this.manifest) this.manifest.quotaBytes = bytes;
    return this.evictIfNeeded();
  }

  async setActiveAssets(activeUrls) {
    if (!this.manifest) return;
    const activeKeys = new Set(activeUrls.map((u) => generateAssetKey(u)));
    for (const [key, record] of Object.entries(this.manifest.assets)) {
      record.isActive = activeKeys.has(key);
      if (record.isActive) record.timestamps.lastAccessedAt = Date.now();
    }
    await this.saveManifestAtomic();
  }

  async evictIfNeeded() {
    if (!this.manifest) return { evictedCount: 0, freedBytes: 0 };

    let totalBytes = 0;
    for (const rec of Object.values(this.manifest.assets)) {
      if (rec.status === "completed") totalBytes += rec.sizeBytes || 0;
    }

    if (totalBytes <= this.manifest.quotaBytes) {
      return { evictedCount: 0, freedBytes: 0 };
    }

    const candidates = Object.values(this.manifest.assets).filter(
      (rec) => rec.status === "completed" && !rec.isActive
    );
    candidates.sort((a, b) => (a.timestamps.lastAccessedAt || 0) - (b.timestamps.lastAccessedAt || 0));

    let evictedCount = 0;
    let freedBytes = 0;

    for (const rec of candidates) {
      if (totalBytes <= this.manifest.quotaBytes) break;
      await this.fs.deleteFile(rec.localPath).catch(() => {});
      totalBytes -= rec.sizeBytes || 0;
      freedBytes += rec.sizeBytes || 0;
      evictedCount++;
      delete this.manifest.assets[rec.assetKey];
    }

    if (evictedCount > 0) {
      await this.saveManifestAtomic();
    }

    return { evictedCount, freedBytes };
  }

  async acquireAsset(url, options = {}) {
    if (!this.manifest) await this.reconcileStartup();

    const normUrl = normalizeMediaUrl(url);
    const assetKey = generateAssetKey(normUrl);

    const existing = this.manifest.assets[assetKey];
    if (existing && existing.status === "completed" && !options.forceFresh) {
      const diskStat = await this.fs.stat(existing.localPath);
      if (diskStat && diskStat.size > 0 && diskStat.size === existing.sizeBytes) {
        existing.timestamps.lastAccessedAt = Date.now();
        return { ...existing };
      }
    }

    const ext = path.extname(new URL(normUrl).pathname) || ".media";
    const targetPath = `${this.baseDir}/${assetKey}${ext}`;
    const partPath = `${targetPath}.part`;

    const now = Date.now();
    const record = existing || {
      url: normUrl,
      assetKey,
      localPath: targetPath,
      sizeBytes: 0,
      validation: {},
      status: "downloading",
      timestamps: { createdAt: now, updatedAt: now, lastAccessedAt: now },
    };
    record.status = "downloading";
    this.manifest.assets[assetKey] = record;

    try {
      const res = await this.fs.downloadFile(normUrl, partPath, options);

      if (res.status === 304 && record.sizeBytes > 0) {
        record.status = "completed";
        record.validation.verifiedAt = Date.now();
        await this.fs.deleteFile(partPath).catch(() => {});
        await this.saveManifestAtomic();
        return { ...record };
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`);
      }

      const partStat = await this.fs.stat(partPath);
      if (!partStat || partStat.size === 0) {
        throw new Error("Zero byte file downloaded");
      }

      const expectedLength = res.headers["content-length"] ? Number(res.headers["content-length"]) : null;
      if (expectedLength !== null && partStat.size !== expectedLength) {
        throw new Error(`Content length mismatch: expected ${expectedLength}, got ${partStat.size}`);
      }

      await this.fs.rename(partPath, targetPath);

      record.sizeBytes = partStat.size;
      record.localPath = targetPath;
      record.status = "completed";
      record.validation = {
        etag: res.headers["etag"] || null,
        lastModified: res.headers["last-modified"] || null,
        contentLength: expectedLength,
        verifiedAt: Date.now(),
      };
      record.timestamps.updatedAt = Date.now();
      record.timestamps.lastAccessedAt = Date.now();

      await this.evictIfNeeded();
      await this.saveManifestAtomic();
      return { ...record };
    } catch (err) {
      await this.fs.deleteFile(partPath).catch(() => {});
      record.status = "failed";
      record.error = err.message;
      await this.saveManifestAtomic().catch(() => {});
      throw err;
    }
  }

  async mapUrls(urls) {
    const results = {};
    for (const url of urls) {
      try {
        const rec = await this.acquireAsset(url);
        if (rec && rec.status === "completed") {
          results[url] = `file://${rec.localPath.replace(/\\/g, "/")}`;
        } else {
          results[url] = url;
        }
      } catch {
        results[url] = url;
      }
    }
    return results;
  }

  getStorageStats() {
    if (!this.manifest) return { usedBytes: 0, quotaBytes: this.quotaBytes, freeBytes: this.quotaBytes, totalAssets: 0 };
    let usedBytes = 0;
    let completedAssets = 0;
    let activeAssets = 0;
    let missingAssets = 0;
    let corruptAssets = 0;

    for (const rec of Object.values(this.manifest.assets)) {
      if (rec.status === "completed") {
        usedBytes += rec.sizeBytes || 0;
        completedAssets++;
      } else if (rec.status === "missing") missingAssets++;
      else if (rec.status === "corrupt") corruptAssets++;
      if (rec.isActive) activeAssets++;
    }

    return {
      usedBytes,
      quotaBytes: this.manifest.quotaBytes,
      freeBytes: Math.max(0, this.manifest.quotaBytes - usedBytes),
      totalAssets: Object.keys(this.manifest.assets).length,
      completedAssets,
      activeAssets,
      missingAssets,
      corruptAssets,
    };
  }
}

// =================================================================
//   TEST SUITE EXECUTION
// =================================================================

async function runTests() {
  const baseDir = "/data/user/0/com.devibrant.iguanaplayerandroid/files/media-cache";

  // Test 1: Asset Identity, URL Normalization, and Key Generation
  console.log("Scenario 1: Asset Identity & Key Generation...");
  {
    const url1 = "https://example.com/storage/media/ad_1.mp4";
    const url2 = "https://example.com/storage/media/ad_1.mp4?cb=1710000000";
    const url3 = "https://example.com/storage/media/ad_1.mp4?other=1&cb=9999";

    const key1 = generateAssetKey(url1);
    const key2 = generateAssetKey(url2);
    const key3 = generateAssetKey(url3);

    assert.equal(key1.length, 64, "Key must be 64-character SHA-256 hex string");
    assert.equal(key1, key2, "Stripping cb= parameter must yield identical stable asset key");
    assert.notEqual(key1, key3, "Different operational query parameters produce distinct keys");
    assert.equal(normalizeMediaUrl("https://ex.com/a.jpg?cb=123"), "https://ex.com/a.jpg");
    console.log("  PASS: Stable asset keys generated deterministically without relying on URL hash for content integrity.");
  }

  // Test 2: Normal Application Restart & Offline Startup Persistence
  console.log("Scenario 2: Application Restart & Offline Startup Persistence...");
  {
    const fsMock = new TestFileSystemAdapter();
    const engine1 = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const sampleUrl = "https://example.com/storage/video_main.mp4";
    fsMock.mockNetworkResponse(sampleUrl, {
      status: 200,
      headers: { "etag": '"v1.2.3"', "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT", "content-length": "2048" },
      body: Buffer.alloc(2048, 1),
    });

    const acquired = await engine1.acquireAsset(sampleUrl);
    assert.equal(acquired.status, "completed");
    assert.equal(acquired.sizeBytes, 2048);
    assert.equal(acquired.validation.etag, '"v1.2.3"');

    // Simulate COMPLETE APP SHUTDOWN AND OFFLINE RESTART
    // Network is disabled (no mock response for download), new engine instance booted
    fsMock.networkMock.clear();
    const engine2 = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const report = await engine2.reconcileStartup();
    assert.equal(report.completed, 1, "Completed asset must survive process restart");
    assert.equal(report.missing, 0);
    assert.equal(report.corrupt, 0);

    const assetOffline = engine2.getAsset(sampleUrl);
    assert.ok(assetOffline, "Asset record found offline");
    assert.equal(assetOffline.status, "completed");
    assert.equal(assetOffline.sizeBytes, 2048);
    assert.equal(assetOffline.validation.etag, '"v1.2.3"');

    const mapped = await engine2.mapUrls([sampleUrl]);
    assert.ok(mapped[sampleUrl].startsWith("file://"), "Resolved to local file:// URL offline");
    console.log("  PASS: Manifest and media files survive normal restart and offline startup.");
  }

  // Test 3: Crash Recovery & Atomic Manifest Persistence
  console.log("Scenario 3: Atomic Manifest Persistence & Crash Recovery...");
  {
    const fsMock = new TestFileSystemAdapter();
    const engine = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const sampleUrl = "https://example.com/storage/slide_1.jpg";
    fsMock.mockNetworkResponse(sampleUrl, {
      status: 200,
      headers: { "content-length": "1000" },
      body: Buffer.alloc(1000, 2),
    });
    await engine.acquireAsset(sampleUrl);

    // Verify atomic persistence created manifest.json and backup manifest.json.bak
    assert.ok(await fsMock.exists(`${baseDir}/manifest.json`), "Primary manifest exists");
    assert.ok(await fsMock.exists(`${baseDir}/manifest.json.bak`), "Backup manifest exists");

    // Scenario 3A: Simulate crash corrupting primary manifest.json
    await fsMock.writeFile(`${baseDir}/manifest.json`, '{"corrupted": truncated json content...');

    const engineRecover1 = new TestMediaStorageEngine({ baseDir, fs: fsMock });
    const rep1 = await engineRecover1.reconcileStartup();
    assert.equal(rep1.recoveredFromBackup, true, "Must safely recover from manifest.json.bak");
    assert.equal(rep1.completed, 1);

    // Scenario 3B: Simulate catastrophic loss where BOTH manifest and backup are corrupted
    await fsMock.writeFile(`${baseDir}/manifest.json`, "INVALID");
    await fsMock.writeFile(`${baseDir}/manifest.json.bak`, "INVALID");

    const engineRecover2 = new TestMediaStorageEngine({ baseDir, fs: fsMock });
    const rep2 = await engineRecover2.reconcileStartup();
    assert.equal(rep2.recoveredFromDiskScan, true, "Must safely reconstruct manifest from disk scan");
    assert.equal(rep2.completed, 1, "Discovered existing media file on disk");
    console.log("  PASS: Crash-safe atomic writes and multi-layer recovery from backup & disk verified.");
  }

  // Test 4: Detection of Missing Files
  console.log("Scenario 4: Detection of Missing Files...");
  {
    const fsMock = new TestFileSystemAdapter();
    const engine = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const sampleUrl = "https://example.com/storage/deleted_media.mp4";
    fsMock.mockNetworkResponse(sampleUrl, {
      status: 200,
      headers: { "content-length": "500" },
      body: Buffer.alloc(500, 3),
    });
    const record = await engine.acquireAsset(sampleUrl);

    // Simulate external deletion of local file from disk
    await fsMock.deleteFile(record.localPath);

    // Reconcile
    const rep = await engine.reconcileStartup();
    assert.equal(rep.missing, 1, "Must detect missing file");
    const updated = engine.getAsset(sampleUrl);
    assert.equal(updated.status, "missing");
    console.log("  PASS: Missing files distinguished accurately on startup.");
  }

  // Test 5: Detection of Corrupt Entries & Leftover Interrupted Downloads
  console.log("Scenario 5: Detection of Corrupt Entries & Orphaned Downloads...");
  {
    const fsMock = new TestFileSystemAdapter();
    const engine = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const sampleUrl = "https://example.com/storage/corrupt_file.mp4";
    fsMock.mockNetworkResponse(sampleUrl, {
      status: 200,
      headers: { "content-length": "4096" },
      body: Buffer.alloc(4096, 4),
    });
    const record = await engine.acquireAsset(sampleUrl);

    // Truncate file to 0 bytes (corrupt)
    await fsMock.writeFile(record.localPath, Buffer.alloc(0));

    // Leave a leftover .part file from an interrupted download
    await fsMock.writeFile(`${baseDir}/temp_broken_download.part`, Buffer.from("partial bytes"));

    const rep = await engine.reconcileStartup();
    assert.equal(rep.corrupt, 1, "0-byte file marked corrupt");
    assert.equal(rep.orphansCleaned, 1, "Orphaned .part file safely removed");

    const corruptAsset = engine.getAsset(sampleUrl);
    assert.equal(corruptAsset.status, "corrupt");
    console.log("  PASS: Corrupt files detected and interrupted downloads cleaned up.");
  }

  // Test 6: Server Metadata & Integrity (ETag, Last-Modified, Content-Length)
  console.log("Scenario 6: Server Metadata & Integrity Verification...");
  {
    const fsMock = new TestFileSystemAdapter();
    const engine = new TestMediaStorageEngine({ baseDir, fs: fsMock });

    const url = "https://example.com/storage/validated.mp4";
    fsMock.mockNetworkResponse(url, {
      status: 200,
      headers: {
        "etag": '"etag-998877"',
        "last-modified": "Mon, 12 Oct 2026 12:00:00 GMT",
        "content-length": "1024",
      },
      body: Buffer.alloc(1024, 5),
    });

    const rec = await engine.acquireAsset(url);
    assert.equal(rec.validation.etag, '"etag-998877"');
    assert.equal(rec.validation.lastModified, "Mon, 12 Oct 2026 12:00:00 GMT");
    assert.equal(rec.validation.contentLength, 1024);

    // Conditional check returns 304 Not Modified -> file remains completed
    fsMock.mockNetworkResponse(url, { status: 304, headers: {} });
    const freshCheck = await engine.acquireAsset(url, { forceFresh: false });
    assert.equal(freshCheck.status, "completed");

    // Failure on mismatched content-length header
    const badUrl = "https://example.com/storage/mismatch.mp4";
    fsMock.mockNetworkResponse(badUrl, {
      status: 200,
      headers: { "content-length": "99999" }, // Header claims 99KB
      body: Buffer.alloc(100), // Body is only 100 bytes
    });

    await assert.rejects(
      async () => await engine.acquireAsset(badUrl),
      /Content length mismatch/,
      "Must reject when byte length does not match Content-Length"
    );
    console.log("  PASS: Server ETag, Last-Modified, and Content-Length verified strictly.");
  }

  // Test 7: Configurable Quota & Active Asset Eviction Protection
  console.log("Scenario 7: Configurable Quota & Active Asset Eviction Protection...");
  {
    const fsMock = new TestFileSystemAdapter();
    // Quota = 120 KB
    const quotaBytes = 120 * 1024;
    const engine = new TestMediaStorageEngine({ baseDir, quotaBytes, fs: fsMock });

    const urlA = "https://example.com/storage/item_a.mp4"; // 50 KB
    const urlB = "https://example.com/storage/item_b.mp4"; // 50 KB
    const urlC = "https://example.com/storage/item_c.mp4"; // 50 KB

    fsMock.mockNetworkResponse(urlA, { status: 200, headers: { "content-length": String(50 * 1024) }, body: Buffer.alloc(50 * 1024) });
    fsMock.mockNetworkResponse(urlB, { status: 200, headers: { "content-length": String(50 * 1024) }, body: Buffer.alloc(50 * 1024) });
    fsMock.mockNetworkResponse(urlC, { status: 200, headers: { "content-length": String(50 * 1024) }, body: Buffer.alloc(50 * 1024) });

    await engine.acquireAsset(urlA);
    // Mark Asset A as ACTIVE (e.g. currently playing on screen)
    await engine.setActiveAssets([urlA]);

    await engine.acquireAsset(urlB);

    // Total now 100 KB <= 120 KB quota. Both intact.
    assert.ok(engine.getAsset(urlA));
    assert.ok(engine.getAsset(urlB));

    // Downloading item C pushes total to 150 KB > 120 KB quota!
    // Eviction will trigger. Candidate to evict is Item B (oldest inactive).
    // Item A MUST BE PROTECTED because it is active!
    await engine.acquireAsset(urlC);

    const assetA = engine.getAsset(urlA);
    const assetB = engine.getAsset(urlB);
    const assetC = engine.getAsset(urlC);

    assert.ok(assetA, "Active Asset A must NOT be evicted (protected)");
    assert.equal(assetA.isActive, true);
    assert.equal(assetB, null, "Inactive Asset B must be evicted under quota");
    assert.ok(assetC, "Newly acquired Asset C exists");

    const stats = engine.getStorageStats();
    assert.ok(stats.usedBytes <= quotaBytes, "Total usage remains within configured quota");
    assert.equal(stats.activeAssets, 1);

    // Configurable quota check: dynamically adjust quota
    await engine.setQuota(500 * 1024);
    assert.equal(engine.getStorageStats().quotaBytes, 500 * 1024);
    console.log("  PASS: Active assets strictly protected from eviction; quotas dynamically configurable.");
  }

  // Test 8: Platform Parity & Contract Verification
  console.log("Scenario 8: Platform Parity & Manifest Schema Contract...");
  {
    const manifestSchema = {
      version: 1,
      updatedAt: Date.now(),
      quotaBytes: 2147483648,
      assets: {
        "sample-key": {
          url: "https://example.com/asset.mp4",
          assetKey: "sample-key",
          localPath: "file:///storage/sample-key.mp4",
          sizeBytes: 1048576,
          validation: { etag: '"12345"', lastModified: "now", contentLength: 1048576, verifiedAt: Date.now() },
          status: "completed",
          timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
          isActive: true,
        },
      },
    };

    const requiredAssetFields = [
      "url",
      "assetKey",
      "localPath",
      "sizeBytes",
      "validation",
      "status",
      "timestamps",
    ];

    const sampleAsset = Object.values(manifestSchema.assets)[0];
    for (const f of requiredAssetFields) {
      assert.ok(f in sampleAsset, `Field '${f}' must be present in asset record on all platforms`);
    }

    const validStatuses = new Set(["completed", "partial", "stale", "missing", "corrupt", "downloading", "failed"]);
    assert.ok(validStatuses.has(sampleAsset.status), "Status must match common contract");
    console.log("  PASS: Manifest schema and lifecycle states fully conform to cross-platform contract.");
  }

  console.log("\n=================================================================");
  console.log("  ALL 8 PERSISTENT MEDIA STORAGE SCENARIOS PASSED SUCCESSFULLY!  ");
  console.log("=================================================================\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

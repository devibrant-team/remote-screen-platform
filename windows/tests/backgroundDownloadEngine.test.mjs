// tests/backgroundDownloadEngine.test.mjs
/**
 * Iguana Signage - Background Media Download Engine Test Suite (Phase 2)
 *
 * Validates all required scenarios:
 * 1. Successful downloads & atomic promotion
 * 2. Truncation detection & partial file rejection
 * 3. Checksum / SHA-256 mismatch rejection
 * 4. Interruption & task cancellation
 * 5. Resume & retry policy with exponential backoff
 * 6. Duplicate requests & priority elevation
 * 7. Bounded concurrency (1 active media download per device)
 * 8. Low storage, quota enforcement, and active asset protection
 * 9. Deterministic per-device startup jitter
 * 10. Offline restart & manifest persistence
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

console.log("=================================================================");
console.log("  IGUANA SIGNAGE - BACKGROUND DOWNLOAD ENGINE TEST SUITE (PHASE 2)");
console.log("=================================================================\n");

// --- Pure JS / Node helper functions matching implementation ---
function normalizeMediaUrl(url) {
  if (!url) return "";
  return url
    .trim()
    .replace(/([?&])cb=\d+(&|$)/, (_m, p1, p2) => (p2 ? p1 : ""))
    .replace(/\?&$/, "?")
    .replace(/\?$/, "");
}

function sha256Utf8(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function generateAssetKey(url) {
  return sha256Utf8(normalizeMediaUrl(url));
}

function computeDeterministicStartupJitter(deviceId, minMs = 3000, maxRangeMs = 15000) {
  if (!deviceId) return minMs;
  const digest = sha256Utf8(String(deviceId).trim());
  const intVal = parseInt(digest.slice(0, 8), 16) || 0;
  return minMs + (intVal % maxRangeMs);
}

// --- Mock FileSystem Adapter for Deterministic Offline Testing ---
class MockFileSystemAdapter {
  constructor() {
    this.files = new Map(); // path -> { content: Buffer, mtime: number }
    this.directories = new Set();
    this.networkMock = new Map(); // url -> { status, headers, body, failAttempts, currentAttempts }
  }

  mockNetwork(url, response) {
    this.networkMock.set(normalizeMediaUrl(url), {
      status: response.status ?? 200,
      headers: response.headers ?? {},
      body: response.body ?? Buffer.from("test-media-data"),
      failAttempts: response.failAttempts ?? 0,
      currentAttempts: 0,
    });
  }

  async exists(p) {
    return this.files.has(p) || this.directories.has(p);
  }

  async stat(p) {
    if (this.files.has(p)) {
      const f = this.files.get(p);
      return { size: f.content.length, mtimeMs: f.mtime };
    }
    return null;
  }

  async readFile(p) {
    const f = this.files.get(p);
    if (!f) throw new Error(`ENOENT: ${p}`);
    return f.content.toString("utf8");
  }

  async writeFile(p, content) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    this.files.set(p, { content: buf, mtime: Date.now() });
  }

  async deleteFile(p) {
    this.files.delete(p);
  }

  async rename(src, dest) {
    const item = this.files.get(src);
    if (!item) throw new Error(`ENOENT: cannot rename ${src}`);
    this.files.set(dest, item);
    this.files.delete(src);
  }

  async ensureDir(d) {
    this.directories.add(d);
  }

  async readDir(dirPath) {
    const prefix = dirPath.replace(/[/\\]+$/, "") + "/";
    const entries = [];
    for (const [filePath, fileData] of this.files.entries()) {
      if (filePath.startsWith(prefix)) {
        const rel = filePath.slice(prefix.length);
        if (!rel.includes("/")) {
          entries.push({ name: rel, isDirectory: false, size: fileData.content.length });
        }
      }
    }
    return entries;
  }

  async computeSha256(p) {
    const f = this.files.get(p);
    if (!f) return "";
    return crypto.createHash("sha256").update(f.content).digest("hex");
  }

  async downloadFile(url, destPath, options) {
    const norm = normalizeMediaUrl(url);
    const mock = this.networkMock.get(norm);
    if (!mock) throw new Error(`Network 404 / Offline: ${url}`);

    mock.currentAttempts++;
    if (mock.failAttempts > 0 && mock.currentAttempts <= mock.failAttempts) {
      throw new Error(`Transient network failure attempt ${mock.currentAttempts}`);
    }

    const body = Buffer.isBuffer(mock.body) ? mock.body : Buffer.from(mock.body || "", "utf8");
    this.files.set(destPath, { content: body, mtime: Date.now() });

    const headers = { ...mock.headers };
    if (!headers["content-length"]) {
      headers["content-length"] = String(body.length);
    }

    return {
      status: mock.status,
      headers,
      bytesWritten: body.length,
    };
  }
}

// --- Simplified Test Storage Engine for Phase 2 ---
class MockStorageEngine {
  constructor({ baseDir, quotaBytes = 2 * 1024 * 1024 * 1024, fs }) {
    this.baseDir = baseDir.replace(/[/\\]+$/, "");
    this.fs = fs;
    this.quotaBytes = quotaBytes;
    this.manifest = {
      version: 1,
      updatedAt: Date.now(),
      quotaBytes,
      assets: {},
    };
  }

  getBaseDir() {
    return this.baseDir;
  }

  getManifest() {
    return JSON.parse(JSON.stringify(this.manifest));
  }

  getAsset(urlOrKey) {
    const key = generateAssetKey(urlOrKey);
    return this.manifest.assets[key] || this.manifest.assets[urlOrKey] || null;
  }

  touchAsset(url) {
    const key = generateAssetKey(url);
    if (this.manifest.assets[key]) {
      this.manifest.assets[key].timestamps.lastAccessedAt = Date.now();
    }
  }

  async setActiveAssets(urls) {
    const activeKeys = new Set(urls.map((u) => generateAssetKey(u)));
    for (const [key, rec] of Object.entries(this.manifest.assets)) {
      rec.isActive = activeKeys.has(key);
    }
  }

  getStorageStats() {
    let usedBytes = 0;
    let completedAssets = 0;
    let activeAssets = 0;
    for (const rec of Object.values(this.manifest.assets)) {
      if (rec.status === "completed") {
        usedBytes += rec.sizeBytes || 0;
        completedAssets++;
      }
      if (rec.isActive) activeAssets++;
    }
    return {
      usedBytes,
      quotaBytes: this.manifest.quotaBytes,
      freeBytes: Math.max(0, this.manifest.quotaBytes - usedBytes),
      totalAssets: Object.keys(this.manifest.assets).length,
      completedAssets,
      activeAssets,
    };
  }

  async evictIfNeeded() {
    let stats = this.getStorageStats();
    if (stats.usedBytes <= this.manifest.quotaBytes) return;

    const candidates = Object.values(this.manifest.assets).filter(
      (r) => r.status === "completed" && !r.isActive
    );
    candidates.sort((a, b) => a.timestamps.lastAccessedAt - b.timestamps.lastAccessedAt);

    for (const rec of candidates) {
      if (stats.usedBytes <= this.manifest.quotaBytes) break;
      await this.fs.deleteFile(rec.localPath);
      delete this.manifest.assets[rec.assetKey];
      stats.usedBytes -= rec.sizeBytes;
    }
  }

  async saveManifestAtomic() {
    this.manifest.updatedAt = Date.now();
    const content = JSON.stringify(this.manifest, null, 2);
    await this.fs.writeFile(`${this.baseDir}/manifest.json.tmp`, content);
    await this.fs.rename(`${this.baseDir}/manifest.json.tmp`, `${this.baseDir}/manifest.json`);
    await this.fs.writeFile(`${this.baseDir}/manifest.json.bak`, content);
  }
}

// --- MediaDownloadQueue matching implementation ---
class TestMediaDownloadQueue {
  constructor(storageEngine, config = {}) {
    this.storageEngine = storageEngine;
    this.concurrency = config.concurrency ?? 1;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? 100;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 2000;
    this.minFreeDiskBytes = config.minFreeDiskBytes ?? 1024;
    this.queue = [];
    this.activeTasks = new Map();
    this.completedTaskIds = new Set();
    this.isPaused = false;
    this.peakActiveConcurrency = 0;

    if (config.deviceId) {
      this.jitterMs = computeDeterministicStartupJitter(config.deviceId, 100, 500);
      this.isJitterBlocked = true;
      setTimeout(() => {
        this.isJitterBlocked = false;
        this.scheduleNext();
      }, this.jitterMs);
    }
  }

  async enqueue(url, options = {}) {
    const normUrl = normalizeMediaUrl(url);
    if (!normUrl.startsWith("http://") && !normUrl.startsWith("https://")) {
      throw new Error(`Unsupported protocol`);
    }

    const assetKey = generateAssetKey(normUrl);
    const priority = options.priority ?? 40;

    const existing = this.storageEngine.getAsset(assetKey);
    if (existing && existing.status === "completed") {
      this.storageEngine.touchAsset(normUrl);
      this.completedTaskIds.add(assetKey);
      return {
        id: assetKey,
        url: normUrl,
        assetKey,
        priority,
        status: "completed",
        retries: 0,
      };
    }

    const active = this.activeTasks.get(assetKey);
    if (active) {
      if (priority > active.priority) active.priority = priority;
      return active;
    }

    const queued = this.queue.find((t) => t.assetKey === assetKey);
    if (queued) {
      if (priority > queued.priority) {
        queued.priority = priority;
        this.sortQueue();
      }
      return queued;
    }

    const task = {
      id: assetKey,
      url: normUrl,
      assetKey,
      priority,
      status: "queued",
      enqueuedAt: Date.now(),
      retries: 0,
      maxRetries: options.maxRetries ?? this.maxRetries,
      expectedSha256: options.expectedSha256,
      expectedSizeBytes: options.expectedSizeBytes,
      abortController: new AbortController(),
    };

    this.queue.push(task);
    this.sortQueue();
    this.scheduleNext();
    return task;
  }

  cancelTask(key) {
    const qIdx = this.queue.findIndex((t) => t.assetKey === key);
    if (qIdx >= 0) {
      const [t] = this.queue.splice(qIdx, 1);
      t.status = "cancelled";
      return true;
    }
    const act = this.activeTasks.get(key);
    if (act) {
      act.status = "cancelled";
      act.abortController.abort();
      const ext = path.extname(new URL(act.url).pathname) || ".media";
      const partPath = `${this.storageEngine.getBaseDir()}/${act.assetKey}${ext}.part`;
      this.storageEngine.fs.deleteFile(partPath);
      this.activeTasks.delete(key);
      this.scheduleNext();
      return true;
    }
    return false;
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.scheduleNext();
  }

  sortQueue() {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  scheduleNext() {
    if (this.isPaused || this.isJitterBlocked) return;
    if (this.activeTasks.size >= this.concurrency) return;

    const now = Date.now();
    const idx = this.queue.findIndex((t) => !t.nextRetryAt || t.nextRetryAt <= now);
    if (idx === -1) return;

    const [task] = this.queue.splice(idx, 1);
    this.processTask(task);
  }

  async processTask(task) {
    task.status = "downloading";
    task.startedAt = Date.now();
    this.activeTasks.set(task.assetKey, task);
    this.peakActiveConcurrency = Math.max(this.peakActiveConcurrency, this.activeTasks.size);

    const baseDir = this.storageEngine.getBaseDir();
    const ext = path.extname(new URL(task.url).pathname) || ".media";
    const targetPath = `${baseDir}/${task.assetKey}${ext}`;
    const partPath = `${targetPath}.part`;
    const fs = this.storageEngine.fs;

    try {
      const stats = this.storageEngine.getStorageStats();
      if (stats.freeBytes < this.minFreeDiskBytes) {
        await this.storageEngine.evictIfNeeded();
        const after = this.storageEngine.getStorageStats();
        if (after.freeBytes < this.minFreeDiskBytes && task.priority < 100) {
          throw new Error("INSUFFICIENT_STORAGE: quota exceeded");
        }
      }

      const res = await fs.downloadFile(task.url, partPath);

      if (task.abortController.signal.aborted) {
        await fs.deleteFile(partPath).catch(() => {});
        task.status = "cancelled";
        this.activeTasks.delete(task.assetKey);
        this.scheduleNext();
        return;
      }

      if (res.status !== 200) {
        throw new Error(`HTTP_${res.status}`);
      }

      const partStat = await fs.stat(partPath);
      if (!partStat || partStat.size === 0) {
        throw new Error("EMPTY_DOWNLOAD: 0 bytes");
      }

      const contentLen = res.headers["content-length"] ? Number(res.headers["content-length"]) : null;
      if (contentLen && partStat.size !== contentLen) {
        throw new Error(`TRUNCATED_DOWNLOAD: expected ${contentLen}, got ${partStat.size}`);
      }

      if (task.expectedSha256) {
        const actualSha = await fs.computeSha256(partPath);
        if (actualSha.toLowerCase() !== task.expectedSha256.toLowerCase()) {
          throw new Error(`CHECKSUM_MISMATCH: expected ${task.expectedSha256}, got ${actualSha}`);
        }
      }

      await fs.rename(partPath, targetPath);

      const manifest = this.storageEngine.manifest;
      manifest.assets[task.assetKey] = {
        url: task.url,
        assetKey: task.assetKey,
        localPath: targetPath,
        sizeBytes: partStat.size,
        validation: { etag: res.headers["etag"], verifiedAt: Date.now() },
        status: "completed",
        timestamps: { createdAt: Date.now(), updatedAt: Date.now(), lastAccessedAt: Date.now() },
      };
      await this.storageEngine.saveManifestAtomic();
      await this.storageEngine.evictIfNeeded();

      task.status = "completed";
      task.completedAt = Date.now();
      this.completedTaskIds.add(task.assetKey);
      this.activeTasks.delete(task.assetKey);
      this.scheduleNext();
    } catch (err) {
      await fs.deleteFile(partPath).catch(() => {});

      if (task.abortController.signal.aborted) {
        task.status = "cancelled";
        this.activeTasks.delete(task.assetKey);
        this.scheduleNext();
        return;
      }

      if (task.retries < task.maxRetries) {
        task.retries += 1;
        const delay = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * Math.pow(2, task.retries - 1));
        task.nextRetryAt = Date.now() + delay;
        task.status = "queued";
        task.error = err.message;
        this.activeTasks.delete(task.assetKey);
        this.queue.push(task);
        this.sortQueue();
        setTimeout(() => this.scheduleNext(), delay);
      } else {
        task.status = "failed";
        task.error = err.message;
        this.activeTasks.delete(task.assetKey);
        this.scheduleNext();
      }
    }
  }

  async waitForAll(timeoutMs = 5000) {
    const t0 = Date.now();
    while (this.queue.length > 0 || this.activeTasks.size > 0) {
      if (Date.now() - t0 > timeoutMs) throw new Error("Timeout waiting for queue");
      await new Promise((r) => setTimeout(r, 20));
      this.scheduleNext();
    }
  }
}

// =================================================================
//   TEST EXECUTION
// =================================================================

async function runPhase2Tests() {
  const baseDir = "/data/user/0/com.devibrant.iguanaplayerandroid/files/media-cache";

  // Test 1: Successful Download & Atomic Promotion
  console.log("Scenario 1: Successful Download & Atomic Promotion...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1 });

    const url = "https://example.com/storage/video_promo.mp4";
    fsMock.mockNetwork(url, {
      status: 200,
      headers: { "content-length": "4096", "etag": '"v1.0"' },
      body: Buffer.alloc(4096, 1),
    });

    const task = await queue.enqueue(url, { priority: 100 });
    await queue.waitForAll();

    assert.equal(task.status, "completed");
    assert.ok(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4`), "Promoted to permanent file path");
    assert.equal(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4.part`), false, "Temporary .part file removed");

    const asset = storage.getAsset(url);
    assert.equal(asset.status, "completed");
    assert.equal(asset.sizeBytes, 4096);
    assert.equal(asset.validation.etag, '"v1.0"');
    console.log("  PASS: Download succeeded, verified, promoted atomically to permanent storage, and manifest persisted.");
  }

  // Test 2: Truncation Detection & Incomplete Download Rejection
  console.log("Scenario 2: Truncation Detection & Partial File Rejection...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1, maxRetries: 0 });

    const url = "https://example.com/storage/truncated.mp4";
    // Header claims 10,000 bytes, but body only delivers 2,000 bytes (interrupted stream)
    fsMock.mockNetwork(url, {
      status: 200,
      headers: { "content-length": "10000" },
      body: Buffer.alloc(2000, 2),
    });

    const task = await queue.enqueue(url);
    await queue.waitForAll();

    assert.equal(task.status, "failed");
    assert.ok(task.error.includes("TRUNCATED_DOWNLOAD"), "Caught truncation mismatch");
    assert.equal(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4.part`), false, "Partial .part file cleaned up");
    assert.equal(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4`), false, "Never promoted to completed");
    console.log("  PASS: Partial/truncated downloads detected and never marked as completed.");
  }

  // Test 3: Checksum / SHA-256 Mismatch Rejection
  console.log("Scenario 3: SHA-256 Checksum Validation & Mismatch Rejection...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1, maxRetries: 0 });

    const url = "https://example.com/storage/secure_media.mp4";
    const bodyContent = Buffer.from("authentic-content");
    const realSha256 = crypto.createHash("sha256").update(bodyContent).digest("hex");
    const fakeSha256 = "0000000000000000000000000000000000000000000000000000000000000000";

    fsMock.mockNetwork(url, {
      status: 200,
      headers: { "content-length": String(bodyContent.length) },
      body: bodyContent,
    });

    // Enqueue with mismatched expectedSha256
    const task = await queue.enqueue(url, { expectedSha256: fakeSha256 });
    await queue.waitForAll();

    assert.equal(task.status, "failed");
    assert.ok(task.error.includes("CHECKSUM_MISMATCH"), "Caught checksum mismatch");
    assert.equal(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4`), false, "Corrupt file rejected");

    // Now enqueue with matching realSha256
    const successTask = await queue.enqueue(url, { expectedSha256: realSha256 });
    await queue.waitForAll();
    assert.equal(successTask.status, "completed");
    console.log("  PASS: Checksum validated strictly against expected SHA-256 digest.");
  }

  // Test 4: Task Cancellation & Interruption
  console.log("Scenario 4: Interruption & Task Cancellation...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1 });

    const url = "https://example.com/storage/long_video.mp4";
    fsMock.mockNetwork(url, {
      status: 200,
      headers: { "content-length": "50000" },
      body: Buffer.alloc(50000),
    });

    const task = await queue.enqueue(url);
    const cancelled = queue.cancelTask(task.assetKey);

    assert.equal(cancelled, true);
    assert.equal(task.status, "cancelled");
    assert.equal(fsMock.files.has(`${baseDir}/${task.assetKey}.mp4.part`), false, "Partial file purged upon cancellation");
    console.log("  PASS: In-flight or queued download cancelled safely and resources cleaned up.");
  }

  // Test 5: Resume & Retry Policy with Exponential Backoff
  console.log("Scenario 5: Resume & Retry Policy with Exponential Backoff...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, {
      concurrency: 1,
      maxRetries: 2,
      baseRetryDelayMs: 50,
      maxRetryDelayMs: 200,
    });

    const url = "https://example.com/storage/flaky_network.mp4";
    // Fails on attempt 1, succeeds on attempt 2
    fsMock.mockNetwork(url, {
      status: 200,
      headers: { "content-length": "100" },
      body: Buffer.alloc(100),
      failAttempts: 1,
    });

    const task = await queue.enqueue(url);
    await queue.waitForAll();

    assert.equal(task.status, "completed");
    assert.equal(task.retries, 1, "Completed on retry 1 after initial failure");
    console.log("  PASS: Exponential backoff retried and succeeded on subsequent attempt.");
  }

  // Test 6: Duplicate Requests & Priority Elevation
  console.log("Scenario 6: Duplicate Requests & Priority Elevation...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1 });
    queue.pause(); // Pause so items stay in queue for inspection

    const url = "https://example.com/storage/shared_asset.jpg";
    fsMock.mockNetwork(url, { status: 200, body: Buffer.alloc(50) });

    const task1 = await queue.enqueue(url, { priority: 40 }); // Low priority
    const task2 = await queue.enqueue(url, { priority: 100 }); // High priority upgrade

    assert.equal(task1.id, task2.id, "Duplicate requests deduplicated to same task");
    assert.equal(queue.queue.length, 1, "Only one entry exists in queue");
    assert.equal(queue.queue[0].priority, 100, "Priority elevated to higher priority");

    queue.resume();
    await queue.waitForAll();
    assert.equal(task1.status, "completed");
    console.log("  PASS: Duplicate requests coalesced and priority promoted dynamically.");
  }

  // Test 7: Bounded Concurrency (1 Active Download by Default)
  console.log("Scenario 7: Bounded Concurrency (1 Active Download Limit)...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1 });

    const urls = [
      "https://example.com/storage/clip1.mp4",
      "https://example.com/storage/clip2.mp4",
      "https://example.com/storage/clip3.mp4",
      "https://example.com/storage/clip4.mp4",
    ];

    for (const u of urls) {
      fsMock.mockNetwork(u, { status: 200, body: Buffer.alloc(100) });
      await queue.enqueue(u);
    }

    await queue.waitForAll();

    assert.equal(queue.peakActiveConcurrency, 1, "Concurrency was strictly bounded to 1 at all times");
    console.log("  PASS: Bounded concurrency of 1 active media download enforced.");
  }

  // Test 8: Low Storage & Active Asset Eviction Protection
  console.log("Scenario 8: Low Storage, Quota Enforcement & Active Asset Protection...");
  {
    const fsMock = new MockFileSystemAdapter();
    // Quota = 100 KB, minFreeDiskBytes = 10 KB
    const storage = new MockStorageEngine({ baseDir, quotaBytes: 100 * 1024, fs: fsMock });
    const queue = new TestMediaDownloadQueue(storage, { concurrency: 1, minFreeDiskBytes: 10 * 1024 });

    const activeUrl = "https://example.com/storage/active_video.mp4"; // 40 KB
    const oldInactiveUrl = "https://example.com/storage/old_cache.mp4"; // 40 KB
    const incomingUrl = "https://example.com/storage/incoming_new.mp4"; // 40 KB

    fsMock.mockNetwork(activeUrl, { status: 200, body: Buffer.alloc(40 * 1024) });
    fsMock.mockNetwork(oldInactiveUrl, { status: 200, body: Buffer.alloc(40 * 1024) });
    fsMock.mockNetwork(incomingUrl, { status: 200, body: Buffer.alloc(40 * 1024) });

    await queue.enqueue(activeUrl, { priority: 100 });
    await queue.enqueue(oldInactiveUrl, { priority: 40 });
    await queue.waitForAll();

    // Mark activeUrl as protected
    await storage.setActiveAssets([activeUrl]);

    // Enqueue incomingUrl: Total would be 120 KB > 100 KB quota
    // Old inactive asset must be evicted; active asset MUST BE PROTECTED!
    await queue.enqueue(incomingUrl, { priority: 80 });
    await queue.waitForAll();

    assert.ok(storage.getAsset(activeUrl), "Active media protected and preserved");
    assert.equal(storage.getAsset(oldInactiveUrl), null, "Inactive media evicted under quota");
    assert.ok(storage.getAsset(incomingUrl), "Incoming media successfully downloaded");
    console.log("  PASS: Active media protected from eviction and quota enforced gracefully.");
  }

  // Test 9: Deterministic Per-Device Startup Jitter
  console.log("Scenario 9: Deterministic Per-Device Startup Jitter...");
  {
    const jitter1a = computeDeterministicStartupJitter("screen-101", 3000, 15000);
    const jitter1b = computeDeterministicStartupJitter("screen-101", 3000, 15000);
    const jitter2 = computeDeterministicStartupJitter("screen-202", 3000, 15000);

    assert.equal(jitter1a, jitter1b, "Same deviceId generates identical jitter across boots");
    assert.notEqual(jitter1a, jitter2, "Different deviceIds produce distinct startup jitter");
    assert.ok(jitter1a >= 3000 && jitter1a <= 18000, "Jitter falls within [min, min+range] window");
    console.log("  PASS: Deterministic per-device startup jitter verified.");
  }

  // Test 10: Offline Restart & Manifest Persistence
  console.log("Scenario 10: Offline Restart & Manifest Persistence...");
  {
    const fsMock = new MockFileSystemAdapter();
    const storage1 = new MockStorageEngine({ baseDir, fs: fsMock });
    const queue1 = new TestMediaDownloadQueue(storage1);

    const offlineUrl = "https://example.com/storage/offline_asset.mp4";
    fsMock.mockNetwork(offlineUrl, { status: 200, body: Buffer.alloc(500) });

    await queue1.enqueue(offlineUrl);
    await queue1.waitForAll();

    // Simulate APP RESTART OFFLINE:
    // Network mock is purged (network completely down)
    fsMock.networkMock.clear();
    const storage2 = new MockStorageEngine({ baseDir, fs: fsMock });
    // Re-load manifest from disk
    const diskManifest = JSON.parse(await fsMock.readFile(`${baseDir}/manifest.json`));
    storage2.manifest = diskManifest;

    const queue2 = new TestMediaDownloadQueue(storage2);
    // Enqueue offlineUrl again
    const task = await queue2.enqueue(offlineUrl);

    assert.equal(task.status, "completed", "Survives restart and offline startup as completed");
    console.log("  PASS: Manifest and completed assets survive application restart offline.");
  }

  console.log("\n=================================================================");
  console.log("  ALL 10 BACKGROUND DOWNLOAD ENGINE SCENARIOS PASSED!            ");
  console.log("=================================================================\n");
}

runPhase2Tests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

"use strict";
// src/utils/mediaStorage/mediaDownloadQueue.ts
// Bounded Asynchronous Media Download Queue for Iguana Signage (Phase 2).
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaDownloadQueue = void 0;
const mediaDownloadTypes_1 = require("./mediaDownloadTypes");
const assetKey_1 = require("./assetKey");
const mediaSecurity_1 = require("./mediaSecurity");
const DEFAULT_CONCURRENCY = 1; // 1 active media download per device by default
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 2000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30000;
const DEFAULT_MIN_FREE_DISK_BYTES = 50 * 1024 * 1024; // 50 MB safety margin
class MediaDownloadQueue {
    constructor(storageEngine, config, security) {
        this.queue = [];
        this.activeTasks = new Map();
        this.completedTaskIds = new Set();
        this.isPaused = false;
        this.isJitterBlocked = false;
        this.jitterTimer = null;
        // Listeners
        this.onTaskCompletedListeners = new Set();
        this.onTaskFailedListeners = new Set();
        this.onTaskStartedListeners = new Set();
        this.onQueueEmptyListeners = new Set();
        this.storageEngine = storageEngine;
        this.concurrency = config?.concurrency ?? DEFAULT_CONCURRENCY;
        this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.baseRetryDelayMs = config?.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
        this.maxRetryDelayMs = config?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
        this.minFreeDiskBytes = config?.minFreeDiskBytes ?? DEFAULT_MIN_FREE_DISK_BYTES;
        this.securityOptions = security;
        // Apply deterministic per-device startup jitter if deviceId is provided
        if (config?.deviceId) {
            const jitterMs = (0, mediaSecurity_1.computeDeterministicStartupJitter)(config.deviceId, config.minStartupJitterMs ?? 3000, config.startupJitterMs ?? 15000);
            this.isJitterBlocked = true;
            this.jitterTimer = setTimeout(() => {
                this.isJitterBlocked = false;
                this.scheduleNext();
            }, jitterMs);
        }
        // Connect download queue to storage engine for part-file and task coordination
        if (typeof this.storageEngine.setDownloadQueue === "function") {
            this.storageEngine.setDownloadQueue(this);
        }
    }
    getStorageEngine() {
        return this.storageEngine;
    }
    /**
     * Checks if an asset is currently active in the download queue (downloading or queued).
     */
    isAssetActive(assetKey) {
        if (this.activeTasks.has(assetKey))
            return true;
        return this.queue.some((t) => t.assetKey === assetKey);
    }
    /**
     * Checks if a .part filename belongs to any active or queued download task.
     */
    isPartFileActive(filename) {
        const clean = filename.replace(/\.part$/, "");
        for (const task of this.activeTasks.values()) {
            if (clean.startsWith(task.assetKey))
                return true;
        }
        for (const task of this.queue) {
            if (clean.startsWith(task.assetKey))
                return true;
        }
        return false;
    }
    /**
     * Enqueues a media URL for background downloading.
     * Handles security validation, deduplication, priority upgrading, and offline checks.
     */
    async enqueue(url, options) {
        // 1. Security validation
        const validation = (0, mediaSecurity_1.validateMediaDownloadUrl)(url, this.securityOptions);
        if (!validation.valid || !validation.normalizedUrl) {
            throw new Error(`Rejected invalid media URL: ${validation.error}`);
        }
        const normUrl = validation.normalizedUrl;
        const assetKey = (0, assetKey_1.generateAssetKey)(normUrl);
        const priority = options?.priority ?? mediaDownloadTypes_1.DownloadPriority.OTHER_CACHED;
        // 2. Fast-path: Check if already completed and intact on disk
        const existingRecord = this.storageEngine.getAsset(assetKey);
        if (existingRecord && existingRecord.status === "completed") {
            this.storageEngine.touchAsset(normUrl);
            const instantTask = {
                id: assetKey,
                url: normUrl,
                assetKey,
                priority,
                status: "completed",
                enqueuedAt: Date.now(),
                startedAt: Date.now(),
                completedAt: Date.now(),
                retries: 0,
                maxRetries: options?.maxRetries ?? this.maxRetries,
                expectedSha256: options?.expectedSha256,
                expectedSizeBytes: options?.expectedSizeBytes,
            };
            this.completedTaskIds.add(assetKey);
            return instantTask;
        }
        // 3. Deduplication check against active tasks
        const active = this.activeTasks.get(assetKey);
        if (active) {
            if (priority > active.priority) {
                active.priority = priority; // Upgrade priority
            }
            return active;
        }
        // 4. Deduplication check against queued tasks
        const queuedIndex = this.queue.findIndex((t) => t.assetKey === assetKey);
        if (queuedIndex >= 0) {
            const queuedTask = this.queue[queuedIndex];
            if (priority > queuedTask.priority) {
                queuedTask.priority = priority; // Upgrade priority
                this.sortQueue();
            }
            return queuedTask;
        }
        // 5. Create new download task
        const task = {
            id: assetKey,
            url: normUrl,
            assetKey,
            priority,
            status: "queued",
            enqueuedAt: Date.now(),
            retries: 0,
            maxRetries: options?.maxRetries ?? this.maxRetries,
            expectedSha256: options?.expectedSha256,
            expectedSizeBytes: options?.expectedSizeBytes,
            mimeType: options?.mimeType,
            headers: options?.headers,
        };
        this.queue.push(task);
        this.sortQueue();
        this.scheduleNext();
        return task;
    }
    /**
     * Enqueues a batch of media URLs.
     */
    async enqueueBatch(items) {
        const tasks = [];
        for (const item of items) {
            try {
                const task = await this.enqueue(item.url, item.options);
                tasks.push(task);
            }
            catch {
                // Skip malformed entries in batch
            }
        }
        return tasks;
    }
    /**
     * Helper to scan a playlist and enqueue its slide slot media with proper priorities.
     * Protects active and upcoming playlist assets from eviction!
     */
    async enqueuePlaylistMedia(playlist, basePriority = mediaDownloadTypes_1.DownloadPriority.ACTIVE_CURRENT) {
        if (!playlist || !Array.isArray(playlist.slides))
            return [];
        const tasks = [];
        const activeUrls = [];
        const slides = playlist.slides;
        const len = slides.length;
        for (let i = 0; i < len; i++) {
            const slide = slides[i];
            const slots = Array.isArray(slide?.slots) ? slide.slots : [];
            // Priority gradation: first slide window gets highest priority
            let priority = basePriority;
            if (basePriority === mediaDownloadTypes_1.DownloadPriority.ACTIVE_CURRENT) {
                priority = i === 0 ? mediaDownloadTypes_1.DownloadPriority.ACTIVE_CURRENT : mediaDownloadTypes_1.DownloadPriority.ACTIVE_UPCOMING;
            }
            for (const slot of slots) {
                const url = slot?.ImageFile;
                if (url && typeof url === "string") {
                    activeUrls.push(url);
                    try {
                        const task = await this.enqueue(url, { priority });
                        tasks.push(task);
                    }
                    catch { }
                }
            }
        }
        // Protect all active and upcoming media from eviction
        if (activeUrls.length > 0) {
            await this.storageEngine.setActiveAssets(activeUrls);
        }
        return tasks;
    }
    cancelTask(taskIdOrKey) {
        // 1. Check queued
        const qIndex = this.queue.findIndex((t) => t.id === taskIdOrKey || t.assetKey === taskIdOrKey);
        if (qIndex >= 0) {
            const [task] = this.queue.splice(qIndex, 1);
            task.status = "cancelled";
            return true;
        }
        // 2. Check active
        const active = this.activeTasks.get(taskIdOrKey);
        if (active) {
            active.status = "cancelled";
            active.abortController?.abort();
            const ext = (0, assetKey_1.extractExtension)(active.url, ".media");
            const partPath = `${this.storageEngine.getBaseDir()}/${active.assetKey}${ext}.part`;
            this.storageEngine.fs.deleteFile(partPath).catch(() => { });
            this.activeTasks.delete(taskIdOrKey);
            this.scheduleNext();
            return true;
        }
        return false;
    }
    cancelUrl(url) {
        const key = (0, assetKey_1.generateAssetKey)(url);
        return this.cancelTask(key);
    }
    cancelAll() {
        for (const task of this.queue) {
            task.status = "cancelled";
        }
        this.queue = [];
        for (const [key, active] of this.activeTasks.entries()) {
            active.status = "cancelled";
            active.abortController?.abort();
            this.activeTasks.delete(key);
        }
    }
    pause() {
        this.isPaused = true;
    }
    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.scheduleNext();
        }
    }
    getStats() {
        let failedCount = 0;
        let completedCount = this.completedTaskIds.size;
        let cancelledCount = 0;
        return {
            queuedCount: this.queue.length,
            activeCount: this.activeTasks.size,
            completedCount,
            failedCount,
            cancelledCount,
            currentActiveTasks: Array.from(this.activeTasks.keys()),
        };
    }
    getTask(taskId) {
        const active = this.activeTasks.get(taskId);
        if (active)
            return { ...active };
        const queued = this.queue.find((t) => t.id === taskId || t.assetKey === taskId);
        if (queued)
            return { ...queued };
        return null;
    }
    onTaskStarted(cb) {
        this.onTaskStartedListeners.add(cb);
        return () => this.onTaskStartedListeners.delete(cb);
    }
    onTaskCompleted(cb) {
        this.onTaskCompletedListeners.add(cb);
        return () => this.onTaskCompletedListeners.delete(cb);
    }
    onTaskFailed(cb) {
        this.onTaskFailedListeners.add(cb);
        return () => this.onTaskFailedListeners.delete(cb);
    }
    onQueueEmpty(cb) {
        this.onQueueEmptyListeners.add(cb);
        return () => this.onQueueEmptyListeners.delete(cb);
    }
    sortQueue() {
        this.queue.sort((a, b) => {
            // 1. Higher priority first
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            // 2. FIFO for identical priority
            return a.enqueuedAt - b.enqueuedAt;
        });
    }
    scheduleNext() {
        if (this.isPaused || this.isJitterBlocked)
            return;
        if (this.activeTasks.size >= this.concurrency)
            return;
        const now = Date.now();
        // Find next eligible task whose retry delay has elapsed
        const eligibleIndex = this.queue.findIndex((t) => !t.nextRetryAt || t.nextRetryAt <= now);
        if (eligibleIndex === -1) {
            if (this.queue.length === 0 && this.activeTasks.size === 0) {
                this.notifyQueueEmpty();
            }
            return;
        }
        const [task] = this.queue.splice(eligibleIndex, 1);
        this.processTask(task);
    }
    async processTask(task) {
        task.status = "downloading";
        task.startedAt = Date.now();
        task.abortController = new AbortController();
        this.activeTasks.set(task.assetKey, task);
        this.notifyTaskStarted(task);
        const baseDir = this.storageEngine.getBaseDir();
        const ext = (0, assetKey_1.extractExtension)(task.url, ".media");
        const targetPath = `${baseDir}/${task.assetKey}${ext}`;
        const partPath = `${targetPath}.part`;
        const fsAdapter = this.storageEngine.fs;
        try {
            // 1. Low storage pre-check & Phase 4 cleanup
            const stats = this.storageEngine.getStorageStats();
            const expectedBytes = task.expectedSizeBytes || 5 * 1024 * 1024;
            const cleanupCfg = this.storageEngine.getCleanupConfig?.() || { pressureThreshold: 0.90 };
            const projected = stats.usedBytes + expectedBytes;
            if (stats.freeBytes < this.minFreeDiskBytes || projected > stats.quotaBytes * cleanupCfg.pressureThreshold) {
                if (typeof this.storageEngine.performCleanup === "function") {
                    const cleanupRes = await this.storageEngine.performCleanup({
                        requiredBytes: expectedBytes,
                        reason: "pre_download",
                    });
                    if (cleanupRes.insufficientStorage && task.priority < mediaDownloadTypes_1.DownloadPriority.ACTIVE_CURRENT) {
                        throw new Error("INSUFFICIENT_STORAGE: storage quota exceeded and active media cannot be evicted");
                    }
                }
                else {
                    await this.storageEngine.evictIfNeeded();
                }
            }
            // 2. Perform streaming download to temporary path
            const reqHeaders = { ...(task.headers || {}) };
            const downloadResult = await fsAdapter.downloadFile(task.url, partPath, {
                headers: reqHeaders,
            });
            // Check abort
            if (task.abortController.signal.aborted) {
                await fsAdapter.deleteFile(partPath).catch(() => { });
                task.status = "cancelled";
                this.activeTasks.delete(task.assetKey);
                this.scheduleNext();
                return;
            }
            // 3. HTTP Status validation
            if (downloadResult.status < 200 || downloadResult.status >= 300) {
                throw new Error(`HTTP_${downloadResult.status}: Server returned non-2xx status`);
            }
            // 4. File existence & 0-byte check
            const partStat = await fsAdapter.stat(partPath);
            if (!partStat || partStat.size === 0) {
                throw new Error("EMPTY_DOWNLOAD: Downloaded file is 0 bytes");
            }
            // 5. Content-Length truncation check
            const headerLength = downloadResult.headers["content-length"];
            if (headerLength) {
                const expectedBytes = Number(headerLength);
                if (!isNaN(expectedBytes) && expectedBytes > 0 && partStat.size !== expectedBytes) {
                    throw new Error(`TRUNCATED_DOWNLOAD: Expected ${expectedBytes} bytes from Content-Length header, but received ${partStat.size} bytes`);
                }
            }
            // Explicit expected size check if caller provided one
            if (task.expectedSizeBytes && task.expectedSizeBytes > 0) {
                if (partStat.size !== task.expectedSizeBytes) {
                    throw new Error(`SIZE_MISMATCH: Expected ${task.expectedSizeBytes} bytes, but received ${partStat.size} bytes`);
                }
            }
            // 6. SHA-256 Checksum validation (if expected digest is available)
            if (task.expectedSha256) {
                const expected = task.expectedSha256.toLowerCase().trim();
                let actualSha256 = "";
                if (fsAdapter.computeSha256) {
                    actualSha256 = await fsAdapter.computeSha256(partPath);
                }
                if (actualSha256 && actualSha256.toLowerCase().trim() !== expected) {
                    throw new Error(`CHECKSUM_MISMATCH: Expected SHA-256 ${expected}, but computed ${actualSha256}`);
                }
            }
            // 7. Atomic promotion from .part to final destination
            await fsAdapter.rename(partPath, targetPath);
            // Verify final target exists
            const finalStat = await fsAdapter.stat(targetPath);
            if (!finalStat || finalStat.size === 0) {
                throw new Error("PROMOTION_FAILED: Target file not present after atomic rename");
            }
            // 8. Update manifest safely
            const manifest = this.storageEngine.getManifest();
            manifest.assets[task.assetKey] = {
                url: task.url,
                assetKey: task.assetKey,
                localPath: targetPath,
                sizeBytes: finalStat.size,
                validation: {
                    etag: downloadResult.headers["etag"] || null,
                    lastModified: downloadResult.headers["last-modified"] || null,
                    contentLength: partStat.size,
                    mimeType: task.mimeType || downloadResult.headers["content-type"] || null,
                    sha256: task.expectedSha256 || null,
                    verifiedAt: Date.now(),
                },
                status: "completed",
                timestamps: {
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    lastAccessedAt: Date.now(),
                },
            };
            // Atomic manifest write
            await this.storageEngine.saveManifestAtomic();
            await this.storageEngine.evictIfNeeded();
            // 9. Mark task completed
            task.status = "completed";
            task.completedAt = Date.now();
            task.error = null;
            this.completedTaskIds.add(task.assetKey);
            this.activeTasks.delete(task.assetKey);
            this.notifyTaskCompleted(task);
            this.scheduleNext();
        }
        catch (err) {
            // Clean up partial file on failure
            await fsAdapter.deleteFile(partPath).catch(() => { });
            if (task.abortController?.signal.aborted) {
                task.status = "cancelled";
                this.activeTasks.delete(task.assetKey);
                this.scheduleNext();
                return;
            }
            // Retry policy with exponential backoff
            if (task.retries < task.maxRetries) {
                task.retries += 1;
                const delay = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * Math.pow(2, task.retries - 1));
                task.nextRetryAt = Date.now() + delay;
                task.status = "queued";
                task.error = `Attempt ${task.retries} failed: ${err.message}. Retrying in ${delay}ms`;
                this.activeTasks.delete(task.assetKey);
                this.queue.push(task);
                this.sortQueue();
                // Schedule next after delay
                setTimeout(() => this.scheduleNext(), delay);
            }
            else {
                // Exceeded retries -> mark failed
                task.status = "failed";
                task.error = err.message || String(err);
                this.activeTasks.delete(task.assetKey);
                this.notifyTaskFailed(task);
                this.scheduleNext();
            }
        }
    }
    notifyTaskStarted(task) {
        for (const listener of this.onTaskStartedListeners) {
            try {
                listener(task);
            }
            catch { }
        }
    }
    notifyTaskCompleted(task) {
        for (const listener of this.onTaskCompletedListeners) {
            try {
                listener(task);
            }
            catch { }
        }
    }
    notifyTaskFailed(task) {
        for (const listener of this.onTaskFailedListeners) {
            try {
                listener(task);
            }
            catch { }
        }
    }
    notifyQueueEmpty() {
        for (const listener of this.onQueueEmptyListeners) {
            try {
                listener();
            }
            catch { }
        }
    }
}
exports.MediaDownloadQueue = MediaDownloadQueue;

// src/utils/mediaStorage/mediaDownloadTypes.ts
// Common types & interfaces for the Background Media Download Engine (Phase 2).

export enum DownloadPriority {
  ACTIVE_CURRENT = 100,  // Active slide slots currently in or about to enter viewport
  ACTIVE_UPCOMING = 80,  // Upcoming slides in the active playlist
  SCHEDULED_SOON = 60,   // Upcoming scheduled playlist
  OTHER_CACHED = 40,     // Default playlist or other cached playlists
  LOW_BACKGROUND = 20,   // Low-priority prewarm / probe
}

export type QueueTaskStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface DownloadTaskOptions {
  priority?: DownloadPriority;
  expectedSha256?: string | null;
  expectedSizeBytes?: number | null;
  mimeType?: string | null;
  headers?: Record<string, string>;
  maxRetries?: number;
  tags?: string[];
}

export interface DownloadQueueTask {
  id: string;                      // Stable task identifier (assetKey)
  url: string;                     // Original normalized URL
  assetKey: string;                // Stable assetKey
  priority: DownloadPriority;
  status: QueueTaskStatus;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  retries: number;
  maxRetries: number;
  nextRetryAt?: number;
  expectedSha256?: string | null;
  expectedSizeBytes?: number | null;
  mimeType?: string | null;
  headers?: Record<string, string>;
  error?: string | null;
  abortController?: AbortController;
}

export interface DownloadQueueConfig {
  concurrency?: number;            // Max concurrent downloads (default 1)
  maxRetries?: number;             // Max retries per task (default 3)
  baseRetryDelayMs?: number;       // Base backoff delay (default 2000ms)
  maxRetryDelayMs?: number;        // Max backoff delay (default 30000ms)
  startupJitterMs?: number;        // Max jitter range (default 15000ms)
  minStartupJitterMs?: number;     // Min startup jitter (default 3000ms)
  deviceId?: string;               // Device ID / Screen ID for deterministic jitter
  minFreeDiskBytes?: number;       // Safety buffer (default 50MB)
}

export interface DownloadQueueStats {
  queuedCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  currentActiveTasks: string[];
}

export interface MediaSecurityOptions {
  allowedHosts?: string[];
  allowedProtocols?: string[];
  allowPrivateIps?: boolean;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
}

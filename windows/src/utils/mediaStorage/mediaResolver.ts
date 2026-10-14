// src/utils/mediaStorage/mediaResolver.ts
// Iguana Signage Hybrid Media Resolver (Windows & Web)
// Resolves local vs remote media sources with active source stability, HTTP Range delivery, and offline resilience.

import { useState, useEffect, useRef, useCallback } from "react";
import { normalizeMediaUrl, generateAssetKey } from "./assetKey";
import { mediaCacheClient, mediaQueueClient } from "./index";
import { DownloadPriority } from "./mediaDownloadTypes";

export type MediaResolutionSource = "local" | "remote" | "fallback";

export interface ResolvedMediaSource {
  resolvedUri: string;
  originalUrl: string;
  source: MediaResolutionSource;
  isLocal: boolean;
  assetKey: string;
  hasFallback: boolean;
  isCorruptOrMissing: boolean;
  status?: string;
}

export interface MediaResolveOptions {
  slotId?: number | string;
  slideId?: number | string;
  mediaType?: "image" | "video" | "gif" | string;
  expectedSha256?: string;
  expectedSizeBytes?: number;
  priority?: number;
  isUpcoming?: boolean;
}

/**
 * Returns a Chromium-compatible local delivery URI with HTTP Range support.
 */
export function getLocalDeliveryUri(
  localPath: string,
  assetKey: string,
  originalUrl?: string
): string {
  if (typeof window !== "undefined") {
    if ((window as any).mediaCache?.getLocalDeliveryUrl) {
      return (window as any).mediaCache.getLocalDeliveryUrl(assetKey, originalUrl);
    }
    const port = (window as any).__MEDIA_PROXY_PORT__ || 17654;
    return `http://127.0.0.1:${port}/local-media?key=${encodeURIComponent(assetKey)}${
      originalUrl ? `&orig=${encodeURIComponent(originalUrl)}` : ""
    }`;
  }

  // Node.js fallback
  return `http://127.0.0.1:17654/local-media?key=${encodeURIComponent(assetKey)}${
    originalUrl ? `&orig=${encodeURIComponent(originalUrl)}` : ""
  }`;
}

/**
 * Checks whether device is currently online.
 */
export function isDeviceOnline(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
}

/**
 * In-memory quick cache for fast synchronous lookup in renderer.
 */
const resolvedMemoryCache = new Map<string, ResolvedMediaSource>();

export function clearResolverMemoryCache(): void {
  resolvedMemoryCache.clear();
}

/**
 * Resolves media source asynchronously across IPC or storage engine.
 */
export async function resolveMediaSource(
  rawUrl: string | undefined | null,
  options?: MediaResolveOptions
): Promise<ResolvedMediaSource> {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      resolvedUri: "",
      originalUrl: "",
      source: "fallback",
      isLocal: false,
      assetKey: "",
      hasFallback: true,
      isCorruptOrMissing: true,
      status: "empty",
    };
  }

  const normUrl = normalizeMediaUrl(rawUrl);
  const assetKey = generateAssetKey(normUrl);

  // 1. Check local asset record
  try {
    const asset = await mediaCacheClient.getAsset(normUrl);

    if (asset && asset.status === "completed" && asset.localPath) {
      const localUri = getLocalDeliveryUri(asset.localPath, assetKey, normUrl);
      const result: ResolvedMediaSource = {
        resolvedUri: localUri,
        originalUrl: rawUrl,
        source: "local",
        isLocal: true,
        assetKey,
        hasFallback: false,
        isCorruptOrMissing: false,
        status: "completed",
      };
      resolvedMemoryCache.set(normUrl, result);
      return result;
    }
  } catch {}

  // 2. Local file missing or incomplete
  const online = isDeviceOnline();

  if (online) {
    const priority =
      options?.priority ??
      (options?.isUpcoming
        ? DownloadPriority.ACTIVE_UPCOMING
        : DownloadPriority.ACTIVE_CURRENT);

    // Non-blocking background download enqueue
    mediaQueueClient
      .enqueue(normUrl, {
        priority,
        expectedSha256: options?.expectedSha256,
        expectedSizeBytes: options?.expectedSizeBytes,
      })
      .catch(() => {});

    const result: ResolvedMediaSource = {
      resolvedUri: rawUrl,
      originalUrl: rawUrl,
      source: "remote",
      isLocal: false,
      assetKey,
      hasFallback: false,
      isCorruptOrMissing: false,
      status: "missing",
    };
    resolvedMemoryCache.set(normUrl, result);
    return result;
  }

  // 3. Offline without cached file -> safe fallback
  const result: ResolvedMediaSource = {
    resolvedUri: "",
    originalUrl: rawUrl,
    source: "fallback",
    isLocal: false,
    assetKey,
    hasFallback: true,
    isCorruptOrMissing: true,
    status: "offline_missing",
  };
  resolvedMemoryCache.set(normUrl, result);
  return result;
}

/**
 * Synchronous resolution using memory cache or immediate fallback.
 */
export function resolveMediaSourceSync(
  rawUrl: string | undefined | null,
  options?: MediaResolveOptions
): ResolvedMediaSource {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      resolvedUri: "",
      originalUrl: "",
      source: "fallback",
      isLocal: false,
      assetKey: "",
      hasFallback: true,
      isCorruptOrMissing: true,
      status: "empty",
    };
  }

  const normUrl = normalizeMediaUrl(rawUrl);
  const cached = resolvedMemoryCache.get(normUrl);
  if (cached) return cached;

  const assetKey = generateAssetKey(normUrl);
  const online = isDeviceOnline();

  if (online) {
    return {
      resolvedUri: rawUrl,
      originalUrl: rawUrl,
      source: "remote",
      isLocal: false,
      assetKey,
      hasFallback: false,
      isCorruptOrMissing: false,
      status: "missing",
    };
  }

  return {
    resolvedUri: "",
    originalUrl: rawUrl,
    source: "fallback",
    isLocal: false,
    assetKey,
    hasFallback: true,
    isCorruptOrMissing: true,
    status: "offline_missing",
  };
}

/**
 * React Hook for resolving media source at slide activation with active source stability.
 */
export function useResolvedMediaSource(
  rawUrl: string | undefined | null,
  options?: {
    slotId?: number | string;
    mediaType?: string;
    isActive?: boolean;
    priority?: number;
  }
): {
  resolvedSource: ResolvedMediaSource | null;
  resolvedUri: string;
  isLocal: boolean;
  hasFallback: boolean;
  promoteIfAvailable: () => void;
} {
  const isActive = options?.isActive ?? true;
  const rawUrlRef = useRef(rawUrl);
  rawUrlRef.current = rawUrl;

  const [resolvedSource, setResolvedSource] = useState<ResolvedMediaSource | null>(() => {
    if (!rawUrl) return null;
    return resolveMediaSourceSync(rawUrl, {
      slotId: options?.slotId,
      mediaType: options?.mediaType,
      priority: options?.priority,
    });
  });

  const activeUrlPinnedRef = useRef<string | null>(rawUrl || null);

  const performResolution = useCallback(() => {
    if (!rawUrlRef.current) {
      setResolvedSource(null);
      activeUrlPinnedRef.current = null;
      return;
    }

    resolveMediaSource(rawUrlRef.current, {
      slotId: options?.slotId,
      mediaType: options?.mediaType,
      priority: options?.priority,
    }).then((res) => {
      activeUrlPinnedRef.current = rawUrlRef.current;
      setResolvedSource(res);
    });
  }, [options?.slotId, options?.mediaType, options?.priority]);

  // Resolve ONLY when rawUrl changes or slot activates!
  useEffect(() => {
    if (rawUrl !== activeUrlPinnedRef.current || (isActive && !resolvedSource)) {
      performResolution();
    }
  }, [rawUrl, isActive, performResolution, resolvedSource]);

  // Active reader lease management (Requirement 3 & 9):
  // Holds reader lease while slide is active to protect file from eviction
  useEffect(() => {
    if (!isActive || !resolvedSource?.assetKey) return;
    mediaCacheClient.acquireReaderLease?.(resolvedSource.assetKey);
    return () => {
      mediaCacheClient.releaseReaderLease?.(resolvedSource.assetKey);
    };
  }, [isActive, resolvedSource?.assetKey]);

  const promoteIfAvailable = useCallback(() => {
    if (!rawUrlRef.current) return;
    resolveMediaSource(rawUrlRef.current, {
      slotId: options?.slotId,
      mediaType: options?.mediaType,
      priority: options?.priority,
    }).then((next) => {
      if (next.isLocal && (!resolvedSource || !resolvedSource.isLocal)) {
        setResolvedSource(next);
      }
    });
  }, [options?.slotId, options?.mediaType, options?.priority, resolvedSource]);

  return {
    resolvedSource,
    resolvedUri: resolvedSource?.resolvedUri || rawUrl || "",
    isLocal: resolvedSource?.isLocal ?? false,
    hasFallback: resolvedSource?.hasFallback ?? false,
    promoteIfAvailable,
  };
}

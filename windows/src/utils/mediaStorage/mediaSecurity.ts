// src/utils/mediaStorage/mediaSecurity.ts
// Security validation & deterministic startup jitter for media downloads.

import { normalizeMediaUrl, sha256Utf8 } from "./assetKey";
import type { MediaSecurityOptions, UrlValidationResult } from "./mediaDownloadTypes";

/**
 * Validates a media download URL against security constraints:
 * - Allowed protocols (HTTP/HTTPS only; reject file, ftp, javascript, data)
 * - Hostname verification (prevent malformed hosts or unauthorized loopback SSRF)
 * - Path traversal prevention
 */
export function validateMediaDownloadUrl(
  urlStr: string,
  options?: MediaSecurityOptions
): UrlValidationResult {
  if (!urlStr || typeof urlStr !== "string") {
    return { valid: false, error: "Empty or invalid URL parameter" };
  }

  const trimmed = urlStr.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Malformed URL syntax" };
  }

  // 1. Protocol check
  const allowedProtocols = options?.allowedProtocols || ["http:", "https:"];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      valid: false,
      error: `Unsupported protocol '${parsed.protocol}'. Only HTTP/HTTPS permitted.`,
    };
  }

  // 2. Hostname check
  const host = parsed.hostname.toLowerCase().trim();
  if (!host) {
    return { valid: false, error: "Missing hostname in media URL" };
  }

  // Disallow loopback SSRF unless explicitly permitted
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLoopback && !options?.allowPrivateIps) {
    return { valid: false, error: "Loopback host is not permitted for media downloads" };
  }

  // Host whitelist check if configured
  if (options?.allowedHosts && options.allowedHosts.length > 0) {
    const isAllowed = options.allowedHosts.some(
      (h) => h.toLowerCase().trim() === host
    );
    if (!isAllowed) {
      return {
        valid: false,
        error: `Host '${host}' is not in the allowed media hosts whitelist`,
      };
    }
  }

  // 3. Path traversal check
  if (parsed.pathname.includes("../") || parsed.pathname.includes("..\\")) {
    return { valid: false, error: "Path traversal detected in media URL" };
  }

  return {
    valid: true,
    normalizedUrl: normalizeMediaUrl(parsed.toString()),
  };
}

/**
 * Calculates a deterministic per-device startup jitter delay.
 * Prevents hundreds of screens in the same venue from hammering the media server
 * at the exact same second on boot, while allowing immediate streaming in SlotMedia
 * to remain completely unaffected.
 */
export function computeDeterministicStartupJitter(
  deviceId?: string | null,
  minMs = 3000,
  maxRangeMs = 15000
): number {
  if (!deviceId) return minMs;
  const digest = sha256Utf8(String(deviceId).trim());
  const intVal = parseInt(digest.slice(0, 8), 16) || 0;
  const offset = intVal % maxRangeMs;
  return minMs + offset;
}

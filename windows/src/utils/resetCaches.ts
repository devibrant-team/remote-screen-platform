// src/utils/resetCaches.ts
import type { QueryClient } from "@tanstack/react-query";

const LS_KEYS_TO_CLEAR = [
  "authToken",
  "lastGoodChildPlaylist",
  "lastGoodDefaultPlaylist",
  "nowPlayingPlaylist",
  "screenId",
  "screenName",
  "linked",
  "pusherTransportTLS",
];

export async function clearAllIguanaCaches(qc?: QueryClient) {
  // 1) React Query cache
  try {
    if (qc) {
      await qc.cancelQueries();
      qc.clear();
      console.log("[RESET] React Query cache cleared");
    }
  } catch (e) {
    console.warn("[RESET] React Query clear error", e);
  }

  // 2) localStorage keys تبعنا فقط
  try {
    LS_KEYS_TO_CLEAR.forEach((k) => localStorage.removeItem(k));
    console.log("[RESET] localStorage keys cleared", LS_KEYS_TO_CLEAR);
  } catch (e) {
    console.warn("[RESET] localStorage clear error", e);
  }

  // 3) Service Worker caches
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log("[RESET] SW caches cleared:", keys);
    }
  } catch (e) {
    console.warn("[RESET] SW cache clear error", e);
  }

  // 4) bridge الاختياري تبع Electron / native (لو موجود)
  try {
    const api = (window as any)?.signage;
    api?.resetDevice?.().catch?.(() => {});
  } catch (e) {
    console.warn("[RESET] bridge resetDevice error", e);
  }
}

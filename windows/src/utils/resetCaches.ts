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

const LS_PREFIXES_TO_CLEAR = [
  "nowPlaying",        // catches nowPlaying*, nowPlayingPlaylist*, etc
  "iguana:nowPlaying", // if you namespace
];

function clearMatchingLocalStorage(prefixes: string[]) {
  const keys = Object.keys(localStorage);
  for (const k of keys) {
    if (prefixes.some((p) => k.startsWith(p))) localStorage.removeItem(k);
  }
}

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

  // 2) localStorage
  try {
    LS_KEYS_TO_CLEAR.forEach((k) => localStorage.removeItem(k));
    clearMatchingLocalStorage(LS_PREFIXES_TO_CLEAR);
    console.log("[RESET] localStorage cleared");
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

  // 4) bridge
  try {
    const api = (window as any)?.signage;
    await api?.resetDevice?.().catch?.(() => {});
  } catch (e) {
    console.warn("[RESET] bridge resetDevice error", e);
  }

  // 5) IMPORTANT: prevent SmartPlayer/HomeScreen effects from re-saving nowPlaying
  try {
    window.location.reload();
  } catch {}
}

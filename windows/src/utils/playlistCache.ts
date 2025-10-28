// src/utils/playlistCache.ts
const LS_LAST_CHILD = "lastGoodChildPlaylist";
const LS_LAST_DEFAULT = "lastGoodDefaultPlaylist";
const LS_NOW_PLAYING = "nowPlayingPlaylist";

export type CachedPlaylist = {
  savedAt: number;
  source: "child" | "default";
  playlist: { slides?: any[] } | null;
};

export function saveLastGoodChild(pl: any) {
  if (Array.isArray(pl?.slides) && pl.slides.length) {
    localStorage.setItem(
      LS_LAST_CHILD,
      JSON.stringify({ savedAt: Date.now(), source: "child", playlist: pl } as CachedPlaylist)
    );
  }
}

export function saveLastGoodDefault(pl: any) {
  if (Array.isArray(pl?.slides) && pl.slides.length) {
    localStorage.setItem(
      LS_LAST_DEFAULT,
      JSON.stringify({ savedAt: Date.now(), source: "default", playlist: pl } as CachedPlaylist)
    );
  }
}

export function loadLastGoodChild(): CachedPlaylist | null {
  try { return JSON.parse(localStorage.getItem(LS_LAST_CHILD) || "null"); } catch { return null; }
}
export function loadLastGoodDefault(): CachedPlaylist | null {
  try { return JSON.parse(localStorage.getItem(LS_LAST_DEFAULT) || "null"); } catch { return null; }
}

// Track the playlist that is actually on screen now
export function setNowPlaying(source: "child" | "default", playlist: any) {
  if (Array.isArray(playlist?.slides) && playlist.slides.length) {
    localStorage.setItem(LS_NOW_PLAYING, JSON.stringify({ savedAt: Date.now(), source, playlist }));
  }
}
export function getNowPlaying(): CachedPlaylist | null {
  try { return JSON.parse(localStorage.getItem(LS_NOW_PLAYING) || "null"); } catch { return null; }
}

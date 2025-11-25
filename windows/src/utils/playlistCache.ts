// src/utils/playlistCache.ts

const LS_LAST_CHILD = "lastGoodChildPlaylist";
const LS_LAST_DEFAULT = "lastGoodDefaultPlaylist";
const LS_NOW_PLAYING = "nowPlayingPlaylist";

export type CachedPlaylist = {
  savedAt: number;
  source: "child" | "default";
  playlist: { slides?: any[] } | null;
};

/** تأكيد أن الـ playlist فعلياً فيها slides */
export function validatePlaylist(pl: any): boolean {
  return Array.isArray(pl?.slides) && pl.slides.length > 0;
}

/** 🔹 Last Good Child Playlist */
export function saveLastGoodChild(pl: any) {
  if (!validatePlaylist(pl)) return;
  localStorage.setItem(
    LS_LAST_CHILD,
    JSON.stringify({
      savedAt: Date.now(),
      source: "child",
      playlist: pl,
    } as CachedPlaylist)
  );
}

export function loadLastGoodChild(): CachedPlaylist | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LAST_CHILD) || "null");
    if (!validatePlaylist(v?.playlist)) return null;
    return v;
  } catch {
    return null;
  }
}

/** 🔹 Last Good Default Playlist */
export function saveLastGoodDefault(pl: any) {
  if (!validatePlaylist(pl)) return;
  localStorage.setItem(
    LS_LAST_DEFAULT,
    JSON.stringify({
      savedAt: Date.now(),
      source: "default",
      playlist: pl,
    } as CachedPlaylist)
  );
}

export function loadLastGoodDefault(): CachedPlaylist | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LAST_DEFAULT) || "null");
    if (!validatePlaylist(v?.playlist)) return null;
    return v;
  } catch {
    return null;
  }
}

/** 🔹 What is currently on screen */
export function setNowPlaying(source: "child" | "default", playlist: any) {
  if (!validatePlaylist(playlist)) return;
  localStorage.setItem(
    LS_NOW_PLAYING,
    JSON.stringify({
      savedAt: Date.now(),
      source,
      playlist,
    })
  );
}

export function getNowPlaying(): CachedPlaylist | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_NOW_PLAYING) || "null");
    if (!validatePlaylist(v?.playlist)) return null;
    return v;
  } catch {
    return null;
  }
}

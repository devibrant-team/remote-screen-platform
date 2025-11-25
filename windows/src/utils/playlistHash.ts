// src/utils/playlistHash.ts
import type { ChildPlaylistResponse } from "../types/schedule";
import { normalizeMediaUrl } from "./mediaPrefetcher";

export function hashPlaylist(
  pl?: ChildPlaylistResponse["playlist"]
): string {
  if (!pl?.slides?.length) return "empty";

  const sig = pl.slides
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((s) => {
      const slotSig = (s.slots || [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((x) =>
          [
            x.id,
            x.mediaId,
            x.mediaType,
            normalizeMediaUrl(x.ImageFile),
            x.scale,
          ].join(":")
        )
        .join("|");

      return [
        s.id,
        s.index,
        s.duration,
        s.grid_style,
        s.transition,
        `[${slotSig}]`,
      ].join(":");
    })
    .join(";");

  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  }

  return String(h);
}

import type { ChildPlaylistResponse } from "../types/schedule";

export function hashPlaylist(pl?: ChildPlaylistResponse["playlist"]): string {
  if (!pl?.slides?.length) return "empty";
  // خفيفة وسريعة: نعتمد على مفاتيح لها معنى بصري
  const sig = pl.slides
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(s => {
      const slotSig = (s.slots || [])
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(x => `${x.id}:${x.mediaId}:${x.mediaType}:${x.ImageFile}:${x.scale}`)
        .join("|");
      return `${s.id}:${s.index}:${s.duration}:${s.grid_style}:${s.transition}[${slotSig}]`;
    })
    .join(";");
  // أبسط هاش (مش تشفير): يقلّص الطول ويعطي مرجع ثابت
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
  return String(h);
}

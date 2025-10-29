// src/types/interactive.ts
export type RawInteractiveSlide = {
  id: number;
  index: number;
  media: string;            // URL
  media_id: number | string;
};

export type InteractivePlaylistDTO = {
  id: number | string;
  name: string;
  slide_number: number;
  style: string;            // e.g. "Interactive1" | "Interactive2"
  slides: RawInteractiveSlide[];
  // duration is optional in your interactive response
  duration?: number;
};

export function isInteractivePlaylist(x: any): x is InteractivePlaylistDTO {
  // Looks interactive if slides exist and first slide has `media` and no `slots`
  const s0 = x?.slides?.[0];
  return !!(Array.isArray(x?.slides) && s0 && s0.media && !s0.slots);
}

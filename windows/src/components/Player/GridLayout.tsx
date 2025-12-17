import type { PlaylistSlide, PlaylistSlot } from "../../types/schedule";
import SlotMedia from "./SlotMedia";
import { WidgetRenderer } from "../widgets/WidgetRenderer";

type GridSpec = { cols: number; rows: number };

const gridSpecFor = (g: number): GridSpec => {
  switch (g) {
    case 1: return { cols: 1, rows: 1 };
    case 2: return { cols: 2, rows: 1 };
    case 3: return { cols: 1, rows: 2 };
    case 4: return { cols: 3, rows: 1 };
    case 5: return { cols: 1, rows: 3 };
    case 6: return { cols: 2, rows: 2 };
    default: return { cols: 1, rows: 1 };
  }
};

// ✅ slot افتراضي لو ما في slots
function makeFallbackSlot(slide: any): PlaylistSlot {
  return {
    id: -1,
    // حسب types عندك يمكن اسمها media_url أو media أو url
    media_url: slide.media_url ?? slide.media ?? slide.url ?? slide.src ?? null,
    media_type: slide.media_type ?? slide.type ?? null,
    widget: null,
    // لو عندك خصائص إضافية بالـ Slot اتركها فارغة
  } as any;
}

export default function GridLayout({
  slide,
  onVideoRef,
  gap = 0,
}: {
  slide: PlaylistSlide;
  onVideoRef: (el: HTMLVideoElement | null) => void;
  gap?: number;
}) {
  const safeGridStyle = Number((slide as any)?.grid_style ?? 1);
  const { cols, rows } = gridSpecFor(safeGridStyle);

  // ✅ دايمًا Array
  const slots: PlaylistSlot[] = Array.isArray((slide as any)?.slots)
    ? ((slide as any).slots as PlaylistSlot[])
    : [makeFallbackSlot(slide)];

  return (
    <div className="w-full h-full">
      <div
        className="grid w-full h-full min-w-0 min-h-0"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          gap,
        }}
      >
        {slots.map((slot: PlaylistSlot, idx: number) => (
          <div
            key={(slot as any).id ?? idx}
            className="relative w-full h-full min-w-0 min-h-0 overflow-hidden bg-black"
          >
            <SlotMedia slot={slot} onVideoRef={onVideoRef} />
            <WidgetRenderer widget={(slot as any).widget as any} />
          </div>
        ))}
      </div>
    </div>
  );
}

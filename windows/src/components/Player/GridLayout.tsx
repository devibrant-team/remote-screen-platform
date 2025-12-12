import type { PlaylistSlide, PlaylistSlot } from "../../types/schedule";
import SlotMedia from "./SlotMedia";
import { WidgetRenderer } from "../widgets/WidgetRenderer";

type GridSpec = { cols: number; rows: number };

/**
 * Map grid_style to an explicit grid (full width & height):
 * 1: 1x1 (single)
 * 2: 2x1 (two columns)
 * 3: 1x2 (two rows)
 * 4: 3x1 (three columns)
 * 5: 1x3 (three rows)
 * 6: 2x2 (four squares)
 */
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

export default function GridLayout({
  slide,
  onVideoRef,
  gap = 0, // set to 8 for gap-2 feel
}: {
  slide: PlaylistSlide;
  onVideoRef: (el: HTMLVideoElement | null) => void;
  gap?: number;
}) {
  const { cols, rows } = gridSpecFor(slide.grid_style);

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
        {slide.slots.map((slot: PlaylistSlot) => (
          <div
            key={slot.id}
            className="relative w-full h-full min-w-0 min-h-0 overflow-hidden bg-black"
          >
            {/* Media */}
            <SlotMedia slot={slot} onVideoRef={onVideoRef} />
            {/* Overlay widgets (clock/weather) */}
            <WidgetRenderer widget={slot.widget as any} />
          </div>
        ))}
      </div>
    </div>
  );
}

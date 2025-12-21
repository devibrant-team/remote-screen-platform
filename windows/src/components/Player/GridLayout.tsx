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

function normalizeType(type?: string | null): string | null {
  if (!type) return null;
  return type.trim().toLowerCase();
}

/**
 * ✅ Only override for specific types to avoid affecting other grid layouts.
 * - "2*2 r" => 1 row + 2 cols (horizontal)
 * - "2*2 c" => 2 rows + 1 col (vertical)
 */
function gridSpecOverrideOnlyFor2(type?: string | null): GridSpec | null {
  const t = normalizeType(type);
  if (!t) return null;

  if (t === "2*2 r" || t === "2x2 r" || t === "2*2r" || t === "2x2r")
    return { cols: 2, rows: 1 };

  if (t === "2*2 c" || t === "2x2 c" || t === "2*2c" || t === "2x2c")
    return { cols: 1, rows: 2 };

  return null;
}

/**
 * ✅ General parser (same behavior as Android)
 * NOTE: keeps your existing interpretation:
 * - "3*3 c" => 3 columns, 1 row
 * - "3*3 r" => 1 column, 3 rows
 * - "4*4 *" => 2x2
 */
function gridSpecFromType(type?: string | null): GridSpec | null {
  const t = normalizeType(type);
  if (!t) return null;

  if (t === "normal") return { cols: 1, rows: 1 };

  const m = t.match(/(\d+)\s*[*x]\s*(\d+)\s*([rc])?/);
  if (!m) return null;

  const n1 = parseInt(m[1], 10) || 1;
  const orient = (m[3] || "").toLowerCase(); // r | c | ""

  const n = n1;

  // ✅ 4*4 => 2x2
  if (n === 4) return { cols: 2, rows: 2 };

  // ✅ keep existing behavior to avoid side-effects
  // c = columns (جنب بعض)
  // r = rows (فوق بعض)
  if (orient === "c") return { cols: n, rows: 1 };
  if (orient === "r") return { cols: 1, rows: n };

  return { cols: n, rows: 1 };
}

// ✅ slot افتراضي لو ما في slots
function makeFallbackSlot(slide: any): PlaylistSlot {
  return {
    id: -1,
    index: 0,
    scale: "fit",
    mediaType: "image",
    mediaId: -1,
    ImageFile:
      slide.media_url ?? slide.media ?? slide.url ?? slide.src ?? "",
    widget: null,
  } as any;
}

// ✅ swap slot 1 and 3 for 2x2 layout (when both exist)
function mapCellToSlotIndex(i: number, cols: number, rows: number) {
  if (cols === 2 && rows === 2) {
    if (i === 1) return 3;
    if (i === 3) return 1;
  }
  return i;
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
  // ✅ IMPORTANT: backend sends grid_id, not grid_style
  const safeGridFallback = Number(
    (slide as any)?.grid_style ?? (slide as any)?.grid_id ?? 1
  );

  // ✅ SAME AS ANDROID:
  // 1) Apply override ONLY for 2*2 r/c
  // 2) Else parse grid_type for ALL other types
  // 3) Else fallback to grid_id/grid_style mapping
  const override = gridSpecOverrideOnlyFor2((slide as any)?.grid_type);
  const fromType = override ?? gridSpecFromType((slide as any)?.grid_type);
  const { cols, rows } = fromType ?? gridSpecFor(safeGridFallback);

  // ✅ sort slots by index (same as Android)
  const sortedSlots = (() => {
    const arr: PlaylistSlot[] = Array.isArray((slide as any)?.slots)
      ? ([...(slide as any).slots] as PlaylistSlot[])
      : [makeFallbackSlot(slide)];

    arr.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
    return arr;
  })();

  const totalCells = cols * rows;

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
        {Array.from({ length: totalCells }).map((_, i) => {
          const slotIndex = mapCellToSlotIndex(i, cols, rows);
          const slot = sortedSlots[slotIndex];

          return (
            <div
              key={(slot as any)?.id ?? `empty-${(slide as any)?.id}-${i}`}
              className="relative w-full h-full min-w-0 min-h-0 overflow-hidden bg-white"
            >
              {slot ? (
                <>
                  <SlotMedia slot={slot} onVideoRef={onVideoRef} />
                  <WidgetRenderer widget={(slot as any).widget as any} />
                </>
              ) : (
                <div className="w-full h-full bg-white" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

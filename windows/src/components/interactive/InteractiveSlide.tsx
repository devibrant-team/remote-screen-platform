// src/features/schedule/interactive/InteractiveSlide.tsx
import React, { useMemo } from "react";
import type { ButtonRect, ButtonAction } from "./buttonRegistry";
import { PERCENTAGE_MODE } from "./buttonRegistry";

export type InteractiveSlideData = {
  id: number;
  index: number;
  url: string;
  mediaId: number | string;
};

function clampStyle(b: ButtonRect) {
  const c = (b.meta as any)?.clamp || {};
  const minW = (c.minWpx ?? 44) + "px";
  const minH = (c.minHpx ?? 44) + "px";
  const prefW = (c.prefVminW ?? 12) + "vmin";
  const prefH = (c.prefVminH ?? 4.5) + "vmin";
  const maxW = (c.maxWpx ?? 240) + "px";
  const maxH = (c.maxHpx ?? 96) + "px";
  return { width: `clamp(${minW}, ${prefW}, ${maxW})`, height: `clamp(${minH}, ${prefH}, ${maxH})` };
}

function withSafeInset(style: React.CSSProperties, meta?: Record<string, unknown>): React.CSSProperties {
  const s = (meta as any)?.safeInsetPct;
  if (!s) return style;
  const left = typeof style.left === "string" ? parseFloat(style.left) : undefined;
  const top = typeof style.top === "string" ? parseFloat(style.top) : undefined;
  const w = typeof style.width === "string" ? parseFloat(style.width) : undefined;
  const h = typeof style.height === "string" ? parseFloat(style.height) : undefined;
  const fix = { ...style };
  if (left !== undefined && w !== undefined) {
    if (s.left && left < s.left * 100) fix.left = `${s.left * 100}%`;
    if (s.right && left + w > 100 - s.right * 100) fix.left = `${100 - s.right * 100 - w}%`;
  }
  if (top !== undefined && h !== undefined) {
    if (s.top && top < s.top * 100) fix.top = `${s.top * 100}%`;
    if (s.bottom && top + h > 100 - s.bottom * 100) fix.top = `${100 - s.bottom * 100 - h}%`;
  }
  return fix;
}

export default function InteractiveSlide({
  slide,
  buttons,
  onAction,
}: {
  slide: InteractiveSlideData;
  buttons: ButtonRect[];
  onAction: (action: ButtonAction) => void;
}) {
  const btns = useMemo(() => buttons ?? [], [buttons]);

  return (
    <div className="relative w-full h-full bg-white overflow-hidden select-none">
      <img
        src={slide.url}
        alt={String(slide.mediaId)}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
        draggable={false}
      />

      {btns.map((b, i) => {
        const base = PERCENTAGE_MODE
          ? { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }
          : { left: b.x, top: b.y, width: b.width, height: b.height };

        const clamps = clampStyle(b);
        const style: React.CSSProperties = withSafeInset(
          { position: "absolute", left: base.left as any, top: base.top as any, width: clamps.width, height: clamps.height },
          b.meta as any
        );

        const explicitLabel = (b.meta as any)?.label as string | undefined;
        const label =
          explicitLabel ??
          (b.type === "next" ? "next" :
           b.type === "prev" ? "back" :
           String(b.type).startsWith("index:") ? `go ${String(b.type).split(":")[1]}` :
           String(b.type).startsWith("goto:") ? `go ${String(b.type).split(":")[1]}` :
           String(b.type).startsWith("open:") ? "open" :
           String(b.type));

        return (
          <div key={b.id ?? `${slide.index}-${i}`} style={style} className="absolute">
            <button
              onClick={() => onAction(b.type)}
              aria-label={label}
              className="
                group w-full h-full
                flex items-center justify-center
                text-[min(3.8vmin,22px)] font-black tracking-wide uppercase
                rounded-xl shadow-lg backdrop-blur-[2px] outline-none transition
                border border-white/25 bg-white/10 hover:bg-white/14 active:bg-white/18
                focus-visible:ring-4 focus-visible:ring-white/35
                hover:shadow-[0_0_0_2px_rgba(255,255,255,.15)]
              "
            >
              <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,.7)]">
                {/* show nothing inside for menu chips? keep text for a11y */}
              </span>
            </button>

            {/* caption under the button (like your mock) */}
            {explicitLabel && (
              <div
                className="
                  absolute left-1/2 -translate-x-1/2
                  mt-1 text-white/90 text-[min(3vmin,18px)] font-medium
                  drop-shadow-[0_1px_1px_rgba(0,0,0,.7)]
                "
                style={{ top: "100%" }}
              >
                {explicitLabel}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

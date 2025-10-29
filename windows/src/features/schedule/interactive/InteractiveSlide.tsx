// src/features/schedule/interactive/InteractiveSlide.tsx
import React from "react";
import type { ButtonRect, ButtonAction } from "./buttonRegistry";
import { PERCENTAGE_MODE } from "./buttonRegistry";

export type InteractiveSlideData = {
  id: number;
  index: number;
  url: string;
  mediaId: number | string;
};

export default function InteractiveSlide({
  slide,
  buttons,
  onAction,
}: {
  slide: InteractiveSlideData;
  buttons: ButtonRect[];
  onAction: (action: ButtonAction) => void;
}) {
  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none">
      <img
        src={slide.url}
        alt={String(slide.mediaId)}
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
      />
      {buttons.map((b, i) => {
        const style = PERCENTAGE_MODE
          ? {
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.width * 100}%`,
              height: `${b.height * 100}%`,
            }
          : { left: b.x, top: b.y, width: b.width, height: b.height };

        return (
// src/features/schedule/interactive/InteractiveSlide.tsx

<button
  key={b.id ?? `${slide.index}-${i}`}
  className="
    absolute flex items-center justify-center
    text-white text-lg font-extrabold tracking-wide
    border border-red-400/70
    bg-red-500/70
    hover:bg-red-600/80
    ring-2 ring-red-300/60
    rounded-lg shadow-lg backdrop-blur-sm
    transition
  "
  style={style as React.CSSProperties}
  onClick={() => onAction(b.type)}
  aria-label={b.type}
>
  {/* ✅ visible action name */}
  {b.type === "next"
    ? "NEXT"
    : b.type === "prev"
    ? "PREV"
    : b.type.startsWith("index:")
    ? `GO ${b.type.split(":")[1]}`
    : b.type.startsWith("goto:")
    ? `GO ${b.type.split(":")[1]}`
    : b.type.startsWith("open:")
    ? "OPEN"
    : b.type.toUpperCase()}
</button>


        );
      })}
    </div>
  );
}
{/* <button
  key={b.id ?? `${slide.index}-${i}`}
  className="
    absolute
    rounded-md
    border border-red-400/70
    bg-red-500/60
    hover:bg-red-500/80
    ring-2 ring-red-300/60
    shadow-md
    backdrop-blur-sm
    transition
  "
  style={style as React.CSSProperties}
  onClick={() => onAction(b.type)}
  aria-label={b.type}
/> */}
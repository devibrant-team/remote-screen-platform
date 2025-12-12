import type { PlaylistSlot } from "../../types/schedule";

type ScaleMode = "fit" | "fill" | "blur" | "original" | string;

const isVideo = (slot: PlaylistSlot) =>
  (slot.mediaType || "").toLowerCase() === "video";

function fitClass(scale?: ScaleMode) {
  const s = (scale || "").toLowerCase();
  if (s === "fill" || s === "cover") return "object-cover";
  if (s === "original" || s === "natural" || s === "actual")
    return "object-contain w-auto h-auto";
  if (s === "blur" || s === "fit" || s === "contain" || !s)
    return "object-contain";
  return "object-contain";
}

/**
 * Renders one slot with scale behavior:
 * - "fit" (contain) / "fill" (cover)
 * - "blur" (fit + blurred cover background)
 * - "original" (natural size, centered)
 */
export default function SlotMedia({
  slot,
  onVideoRef,
}: {
  slot: PlaylistSlot;
  onVideoRef: (el: HTMLVideoElement | null) => void;
}) {
  const scale = (slot.scale || "").toLowerCase();
  const vid = isVideo(slot);

  // Original size: center, no forced scaling
  if (scale === "original" || scale === "natural" || scale === "actual") {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        {vid ? (
          <video
            ref={onVideoRef}
            src={slot.ImageFile}
            className="max-w-full max-h-full w-auto h-auto object-contain"
            muted
            playsInline
            preload="auto"
          />
        ) : (
          <img
            src={slot.ImageFile}
            alt={String(slot.mediaId)}
            className="max-w-full max-h-full w-auto h-auto object-contain"
            loading="eager"
            draggable={false}
          />
        )}
      </div>
    );
  }

  // Fit + Blur BG: blurred cover behind, sharp fit in front
  if (scale === "blur" || scale === "fit-blur" || scale === "blur-bg") {
    return (
      <div className="absolute inset-0">
        {/* Background (cover + blur) */}
        <div className="absolute inset-0">
          {vid ? (
            <video
              // background shouldn't affect timing — do NOT register ref
              src={slot.ImageFile}
              className="w-full h-full object-cover blur-lg scale-[1.05]"
              muted
              playsInline
              preload="auto"
              loop
              autoPlay
            />
          ) : (
            <img
              src={slot.ImageFile}
              alt={String(slot.mediaId)}
              className="w-full h-full object-cover blur-lg scale-[1.05]"
              loading="eager"
              draggable={false}
            />
          )}
          <div className="absolute inset-0 bg-black/25" />
        </div>

        {/* Foreground (fit/contain) */}
        <div className="absolute inset-0 flex items-center justify-center">
          {vid ? (
            <video
              ref={onVideoRef}
              src={slot.ImageFile}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              muted
              playsInline
              preload="auto"
            />
          ) : (
            <img
              src={slot.ImageFile}
              alt={String(slot.mediaId)}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              loading="eager"
              draggable={false}
            />
          )}
        </div>
      </div>
    );
  }

  // Fit (contain) or Fill (cover) + aliases
  return (
    <div className="absolute inset-0">
      {vid ? (
        <video
          ref={onVideoRef}
          src={slot.ImageFile}
          className={`w-full h-full ${fitClass(scale)}`}
          muted
          playsInline
          preload="auto"
        />
      ) : (
        <img
          src={slot.ImageFile}
          alt={String(slot.mediaId)}
          className={`w-full h-full ${fitClass(scale)}`}
          loading="eager"
          draggable={false}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { PlaylistSlot } from "../../types/schedule";
import { normalizeMediaUrl } from "../../utils/mediaPrefetcher";

type ScaleMode = "fit" | "fill" | "blur" | "original" | string;
type MediaKind = "image" | "video";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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

function retryUrl(url: string, retry: number) {
  if (retry <= 0) return url;
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_retry", String(retry));
    return u.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}_retry=${retry}`;
  }
}

function BlackFallback() {
  return <div className="absolute inset-0 bg-black" />;
}

export default function SlotMedia({
  slot,
  onVideoRef,
  onRepeatedFailure,
}: {
  slot: PlaylistSlot;
  onVideoRef: (el: HTMLVideoElement | null) => void;
  onRepeatedFailure?: (slot: PlaylistSlot, reason: string) => void;
}) {
  const scale = (slot.scale || "").toLowerCase();
  const vid = isVideo(slot);
  const kind: MediaKind = vid ? "video" : "image";
  const url = slot.ImageFile || "";

  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const reportedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRetry(0);
    setFailed(!url);
    reportedRef.current = false;
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const markPermanentFailure = (reason: string) => {
    setFailed(true);
    if (!reportedRef.current) {
      reportedRef.current = true;
      onRepeatedFailure?.(slot, reason);
    }
  };

  const handlePrimaryError = () => {
    if (!url) {
      markPermanentFailure(`${kind}:missing-url`);
      return;
    }

    if (retry >= MAX_RETRIES) {
      markPermanentFailure(`${kind}:failed-after-retry`);
      return;
    }

    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
    }

    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetry((n) => n + 1);
    }, RETRY_DELAY_MS);
  };

  if (failed) return <BlackFallback />;

  const src = normalizeMediaUrl(retryUrl(url, retry)) || "";

  const renderVideo = (
    className: string,
    registerRef = true,
    background = false
  ) => (
    <video
      key={`${src}:video`}
      ref={registerRef ? onVideoRef : undefined}
      src={src}
      className={className}
      muted
      playsInline
      preload="auto"
      loop={background}
      autoPlay={background}
      onError={registerRef ? handlePrimaryError : undefined}
    />
  );

  const renderImage = (className: string, primary = true) => (
    <img
      key={`${src}:image`}
      src={src}
      alt={String(slot.mediaId)}
      className={className}
      loading="eager"
      draggable={false}
      onError={primary ? handlePrimaryError : undefined}
    />
  );

  if (scale === "original" || scale === "natural" || scale === "actual") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {vid
          ? renderVideo("max-w-full max-h-full w-auto h-auto object-contain")
          : renderImage("max-w-full max-h-full w-auto h-auto object-contain")}
      </div>
    );
  }

  if (scale === "blur" || scale === "fit-blur" || scale === "blur-bg") {
    return (
      <div className="absolute inset-0 bg-black">
        <div className="absolute inset-0">
          {vid
            ? renderVideo(
                "w-full h-full object-cover blur-lg scale-[1.05]",
                false,
                true
              )
            : renderImage(
                "w-full h-full object-cover blur-lg scale-[1.05]",
                false
              )}
          <div className="absolute inset-0 bg-black/25" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          {vid
            ? renderVideo("max-w-full max-h-full w-auto h-auto object-contain")
            : renderImage("max-w-full max-h-full w-auto h-auto object-contain")}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black">
      {vid
        ? renderVideo(`w-full h-full ${fitClass(scale)}`)
        : renderImage(`w-full h-full ${fitClass(scale)}`)}
    </div>
  );
}

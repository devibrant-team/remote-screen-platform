import { useEffect, useRef, useState } from "react";
import type { PlaylistSlot } from "../../types/schedule";
import { normalizeMediaUrl } from "../../utils/mediaPrefetcher";
import iguanaLogo from "../../assets/Logo.png";

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
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <img
        src={iguanaLogo}
        alt="Iguana"
        className="h-10 w-10 object-contain opacity-90"
        draggable={false}
      />
    </div>
  );
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
  const [painted, setPainted] = useState(false);
  const reportedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRetry(0);
    setFailed(!url);
    setPainted(false);
    reportedRef.current = false;
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [url, kind]);

  useEffect(() => {
    setPainted(false);
  }, [retry, kind]);

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

  const LoadingOverlay = () => (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center text-white">
        <img
          src={iguanaLogo}
          alt="Iguana"
          className="h-10 w-10 object-contain opacity-90"
          draggable={false}
        />
        <span className="mt-2 text-xs font-medium">Loading...</span>
      </div>
    </div>
  );

  const renderVideo = (
    className: string,
    registerRef = true,
    background = false,
    markReady = true
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
      onLoadedData={markReady ? () => setPainted(true) : undefined}
      onCanPlay={markReady ? () => setPainted(true) : undefined}
      onError={registerRef ? handlePrimaryError : undefined}
    />
  );

  const renderImage = (className: string, primary = true, markReady = true) => (
    <img
      key={`${src}:image`}
      src={src}
      alt={String(slot.mediaId)}
      className={className}
      loading="eager"
      draggable={false}
      onLoad={markReady ? () => setPainted(true) : undefined}
      onError={primary ? handlePrimaryError : undefined}
    />
  );

  if (scale === "original" || scale === "natural" || scale === "actual") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {!painted && <LoadingOverlay />}
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
                true,
                false
              )
            : renderImage(
                "w-full h-full object-cover blur-lg scale-[1.05]",
                false,
                false
              )}
          <div className="absolute inset-0 bg-black/25" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          {!painted && <LoadingOverlay />}
          {vid
            ? renderVideo("max-w-full max-h-full w-auto h-auto object-contain")
            : renderImage("max-w-full max-h-full w-auto h-auto object-contain")}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black">
      {!painted && <LoadingOverlay />}
      {vid
        ? renderVideo(`w-full h-full ${fitClass(scale)}`)
        : renderImage(`w-full h-full ${fitClass(scale)}`)}
    </div>
  );
}

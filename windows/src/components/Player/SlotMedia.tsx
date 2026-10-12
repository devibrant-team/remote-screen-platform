import React, { useEffect, useRef, useState } from "react";
import type { PlaylistSlot } from "../../types/schedule";
import { normalizeMediaUrl } from "../../utils/mediaPrefetcher";
import PlayerLoadingOverlay from "./PlayerLoadingOverlay";

type ScaleMode = "fit" | "fill" | "blur" | "original" | string;
type MediaKind = "image" | "video";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FAKE_PROGRESS_MAX = 90;
const IMAGE_LOADING_TIMEOUT_MS = 2500;
const VIDEO_LOADING_TIMEOUT_MS = 4000;
const READY_HIDE_DELAY_MS = 150;

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

const LoadingOverlay = React.memo(function LoadingOverlay({
  progress,
  mediaUri,
}: {
  progress: number | null;
  mediaUri: string;
}) {
  const [displayProgress, setDisplayProgress] = useState<number | null>(
    progress
  );
  const displayProgressRef = useRef<number | null>(progress);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    displayProgressRef.current = progress;
    setDisplayProgress(progress);

    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (progress !== null) return;

    let current = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      current = Math.min(FAKE_PROGRESS_MAX, elapsed / 45);
      const rounded = Math.round(current);

      if (displayProgressRef.current !== rounded) {
        displayProgressRef.current = rounded;
        setDisplayProgress(rounded);
      }

      if (current < FAKE_PROGRESS_MAX) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [progress, mediaUri]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-white">
      <PlayerLoadingOverlay
        visible
        mode="preparing_media"
        message="Preparing media..."
        subtle
        progress={displayProgress}
      />
    </div>
  );
});

const MediaFallback = React.memo(function MediaFallback() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <PlayerLoadingOverlay
        visible
        mode="error_retrying"
        message="Recovering playback..."
        subtle
      />
    </div>
  );
});

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
  const src = normalizeMediaUrl(retryUrl(url, retry)) || "";
  const readyUrisRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(src ? readyUrisRef.current.has(src) : false);
  const [showLoading, setShowLoading] = useState(() => !readyRef.current);
  const [progress, setProgress] = useState<number | null>(null);
  const progressRef = useRef<number | null>(null);
  const reportedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const videoFrameRef = useRef<number | null>(null);
  const frameVideoRef = useRef<HTMLVideoElement | null>(null);

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
    const isReady = !!src && readyUrisRef.current.has(src);
    readyRef.current = isReady;
    setShowLoading(!!src && !isReady);
    setProgress(null);
    progressRef.current = null;

    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (safetyTimerRef.current != null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    if (
      videoFrameRef.current != null &&
      frameVideoRef.current &&
      (frameVideoRef.current as any).cancelVideoFrameCallback
    ) {
      try {
        (frameVideoRef.current as any).cancelVideoFrameCallback(
          videoFrameRef.current
        );
      } catch {}
      videoFrameRef.current = null;
      frameVideoRef.current = null;
    }

    if (src && !isReady) {
      console.log("[LOADING_STATE]", { mode: "preparing_media", src });
      safetyTimerRef.current = window.setTimeout(
        () => {
          if (readyRef.current) return;
          console.log("[KEEP_ACTIVE_VISIBLE]", { reason: "media-timeout", src });
          readyRef.current = true;
          readyUrisRef.current.add(src);
          setProgressIfChanged(100);
          hideTimerRef.current = window.setTimeout(() => {
            setShowLoading(false);
          }, READY_HIDE_DELAY_MS);
        },
        vid ? VIDEO_LOADING_TIMEOUT_MS : IMAGE_LOADING_TIMEOUT_MS
      );
    }

    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (safetyTimerRef.current != null) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current != null) {
        window.clearTimeout(retryTimerRef.current);
      }
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
      }
      if (safetyTimerRef.current != null) {
        window.clearTimeout(safetyTimerRef.current);
      }
      if (
        videoFrameRef.current != null &&
        frameVideoRef.current &&
        (frameVideoRef.current as any).cancelVideoFrameCallback
      ) {
        try {
          (frameVideoRef.current as any).cancelVideoFrameCallback(
            videoFrameRef.current
          );
        } catch {}
      }
    };
  }, []);

  const setProgressIfChanged = (next: number | null) => {
    const rounded =
      typeof next === "number" && Number.isFinite(next)
        ? Math.min(100, Math.max(0, Math.round(next)))
        : null;

    if (progressRef.current === rounded) return;
    progressRef.current = rounded;
    setProgress(rounded);
  };

  const markMediaReady = (reason: string) => {
    if (readyRef.current) return;
    readyRef.current = true;
    if (src) readyUrisRef.current.add(src);
    console.log("[MEDIA_READY]", { src, reason });
    if (safetyTimerRef.current != null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    setProgressIfChanged(100);
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowLoading(false);
    }, READY_HIDE_DELAY_MS);
  };

  const hideLoadingForError = () => {
    if (readyRef.current) return;
    console.log("[LOADING_STATE]", { mode: "error_retrying", src });
    readyRef.current = true;
    if (src) readyUrisRef.current.add(src);
    if (safetyTimerRef.current != null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    setProgressIfChanged(100);
    setShowLoading(false);
  };

  const markPermanentFailure = (reason: string) => {
    hideLoadingForError();
    setFailed(true);
    if (!reportedRef.current) {
      reportedRef.current = true;
      onRepeatedFailure?.(slot, reason);
    }
  };

  const handlePrimaryError = () => {
    hideLoadingForError();

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

  if (failed) return <MediaFallback />;

  const renderVideo = (
    className: string,
    registerRef = true,
    background = false,
    trackReady = true
  ) => {
    const ref = (el: HTMLVideoElement | null) => {
      if (registerRef) onVideoRef(el);
      if (!trackReady || !el || readyRef.current) return;

      frameVideoRef.current = el;
      if ((el as any).requestVideoFrameCallback) {
        try {
          videoFrameRef.current = (el as any).requestVideoFrameCallback(() =>
            markMediaReady("first-frame")
          );
        } catch {}
      }
    };

    return (
    <video
      ref={ref}
      src={src}
      className={className}
      muted
      playsInline
      preload="auto"
      loop={background}
      autoPlay={background}
      onLoadedData={trackReady ? () => markMediaReady("loadeddata") : undefined}
      onCanPlay={trackReady ? () => markMediaReady("readyToPlay") : undefined}
      onCanPlayThrough={trackReady ? () => markMediaReady("readyToPlay") : undefined}
      onPlaying={trackReady ? () => markMediaReady("playing") : undefined}
      onWaiting={
        trackReady
          ? () => console.log("[BUFFERING]", { src, slotId: slot.id })
          : undefined
      }
      onStalled={
        trackReady
          ? () => console.log("[BUFFERING]", { src, slotId: slot.id, stalled: true })
          : undefined
      }
      onError={registerRef ? handlePrimaryError : undefined}
    />
    );
  };

  const renderImage = (className: string, primary = true, trackReady = true) => (
    <img
      src={src}
      alt={String(slot.mediaId)}
      className={className}
      loading="eager"
      draggable={false}
      onLoad={trackReady ? () => markMediaReady("load") : undefined}
      onError={primary ? handlePrimaryError : undefined}
    />
  );

  if (scale === "original" || scale === "natural" || scale === "actual") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        {showLoading && <LoadingOverlay progress={progress} mediaUri={src} />}
        {vid
          ? renderVideo("max-w-full max-h-full w-auto h-auto object-contain")
          : renderImage("max-w-full max-h-full w-auto h-auto object-contain")}
      </div>
    );
  }

  if (scale === "blur" || scale === "fit-blur" || scale === "blur-bg") {
    return (
      <div className="absolute inset-0 bg-white">
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
          <div className="absolute inset-0 bg-white/25" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          {showLoading && <LoadingOverlay progress={progress} mediaUri={src} />}
          {vid
            ? renderVideo("max-w-full max-h-full w-auto h-auto object-contain")
            : renderImage("max-w-full max-h-full w-auto h-auto object-contain")}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-white">
      {showLoading && <LoadingOverlay progress={progress} mediaUri={src} />}
      {vid
        ? renderVideo(`w-full h-full ${fitClass(scale)}`)
        : renderImage(`w-full h-full ${fitClass(scale)}`)}
    </div>
  );
}

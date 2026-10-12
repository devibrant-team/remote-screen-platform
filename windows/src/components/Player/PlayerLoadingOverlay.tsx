import React, { useEffect } from "react";

export type PlayerLoadingMode =
  | "booting"
  | "connecting"
  | "pairing"
  | "fetching"
  | "preparing_media"
  | "buffering"
  | "reconnecting"
  | "no_schedule"
  | "error_retrying"
  | "offline_cached";

type Props = {
  visible: boolean;
  mode: PlayerLoadingMode;
  message?: string;
  subtle?: boolean;
  showSkeleton?: boolean;
  cornerOnly?: boolean;
  progress?: number | null;
};

const DEFAULT_MESSAGES: Record<PlayerLoadingMode, string> = {
  booting: "Preparing display...",
  connecting: "Connecting to server...",
  pairing: "Preparing display...",
  fetching: "Loading media...",
  preparing_media: "Preparing media...",
  buffering: "Loading media...",
  reconnecting: "Reconnecting...",
  no_schedule: "Waiting for schedule...",
  error_retrying: "Recovering playback...",
  offline_cached: "Reconnecting...",
};

const clampProgress = (progress?: number | null) => {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, Math.round(progress)));
};

function Spinner({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={[
        "iguana-loader-ring block rounded-full border-2 border-[#E5E7EB] border-t-[#111827] border-r-transparent",
        compact ? "h-4 w-4" : "h-7 w-7",
      ].join(" ")}
      aria-hidden="true"
    />
  );
}

function Skeleton() {
  return (
    <div className="mt-8 grid w-[min(440px,78vw)] grid-cols-3 gap-3" aria-hidden="true">
      <div className="iguana-skeleton h-16 rounded-md border border-[#E5E7EB] bg-[#F9FAFB]" />
      <div className="iguana-skeleton h-16 rounded-md border border-[#E5E7EB] bg-[#F9FAFB]" />
      <div className="iguana-skeleton h-16 rounded-md border border-[#E5E7EB] bg-[#F9FAFB]" />
      <div className="iguana-skeleton col-span-2 h-2 rounded-full bg-[#F3F4F6]" />
      <div className="iguana-skeleton h-2 rounded-full bg-[#F3F4F6]" />
    </div>
  );
}

const PlayerLoadingOverlay: React.FC<Props> = ({
  visible,
  mode,
  message,
  subtle = false,
  showSkeleton = false,
  cornerOnly = false,
  progress,
}) => {
  const pct = clampProgress(progress);
  const text = message || DEFAULT_MESSAGES[mode];

  useEffect(() => {
    if (!visible) return;
    console.log("[LOADING_OVERLAY]", { mode, cornerOnly, message: text });
  }, [visible, mode, cornerOnly, text]);

  if (!visible) return null;

  if (cornerOnly) {
    return (
      <div className="pointer-events-none absolute bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white/90 px-3 py-2 text-xs font-medium text-[#111827] shadow-sm backdrop-blur">
        <Spinner compact />
        <span className="max-w-[34vw] truncate">{text}</span>
      </div>
    );
  }

  return (
    <div
      className={[
        "pointer-events-none absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-white font-sans text-[#111827]",
        subtle ? "bg-white/96" : "bg-white",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full max-w-xl flex-col items-center px-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full border border-[#E5E7EB] bg-white">
          <Spinner />
        </div>
        <div className="mt-4 text-sm font-semibold">{text}</div>
        <div className="mt-1 text-xs text-[#6B7280]">
          {pct !== null ? `${pct}%` : "Iguana Players"}
        </div>
        {showSkeleton && <Skeleton />}
      </div>
    </div>
  );
};

export default React.memo(PlayerLoadingOverlay);

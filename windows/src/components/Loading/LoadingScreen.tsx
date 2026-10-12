import React from "react";
import PlayerLoadingOverlay from "../Player/PlayerLoadingOverlay";

type LoadingScreenProps = {
  progress?: number | null;
  compact?: boolean;
  label?: string;
};

const clampProgress = (progress?: number | null) => {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, Math.round(progress)));
};

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  progress,
  compact = false,
  label = "Loading",
}) => {
  return (
    <main className="pointer-events-none relative h-full w-full overflow-hidden bg-white">
      <PlayerLoadingOverlay
        visible
        mode={compact ? "preparing_media" : "booting"}
        message={label === "Loading" ? undefined : label}
        progress={clampProgress(progress)}
        subtle={compact}
        showSkeleton={!compact}
      />
    </main>
  );
};

export default React.memo(LoadingScreen);

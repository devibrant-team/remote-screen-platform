import React from "react";
import PlayerLoadingOverlay from "../Player/PlayerLoadingOverlay";

const NoSchedule: React.FC = () => {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-white">
      <PlayerLoadingOverlay
        visible
        mode="no_schedule"
        message="Waiting for schedule..."
        showSkeleton
      />
    </main>
  );
};

export default NoSchedule;

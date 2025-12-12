// src/features/schedule/components/SmartPlayer.tsx
import React from "react";
import type {
  ChildPlaylistResponse,
  ParentScheduleItem,      // 👈 أضف هذي
} from "../../types/schedule";
import PlaylistPlayer from "./PlaylistPlayer";

type PlaylistT = ChildPlaylistResponse["playlist"];

type Props = {
  playlist: PlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
  childStartTime?: string | null;
  /** NEW: الـ parent schedule الكامل (start_time + end_time) */
  activeSchedule?: ParentScheduleItem;
};

const SmartPlayer: React.FC<Props> = ({
  playlist,
  initialIndex,
  screenId,
  scheduleId,
  onRequestRefetch,
  childStartTime,
  activeSchedule,          // 👈 استقبلها
}) => {
  return (
    <PlaylistPlayer
      playlist={playlist}
      initialIndex={initialIndex}
      screenId={screenId}
      scheduleId={scheduleId}
      onRequestRefetch={onRequestRefetch}
      childStartTime={childStartTime}
      activeSchedule={activeSchedule}   // 👈 مرّرها للـ Player
    />
  );
};

export default SmartPlayer;

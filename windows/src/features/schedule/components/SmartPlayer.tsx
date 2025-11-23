// src/features/schedule/components/SmartPlayer.tsx
import React from "react";
import type { ChildPlaylistResponse } from "../../../types/schedule";
import PlaylistPlayer from "./PlaylistPlayer";

type PlaylistT = ChildPlaylistResponse["playlist"];

type Props = {
  playlist: PlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
  /** بداية الـ child schedule (server) "HH:mm:ss" - optional */
  childStartTime?: string | null;
};

const SmartPlayer: React.FC<Props> = ({
  playlist,
  initialIndex,
  screenId,
  scheduleId,
  onRequestRefetch,
  childStartTime,
}) => {
  // إذا عندك منطق إضافي (أنواع layout/interactive) ركّبه هون؛
  // أهم شي تمرّر childStartTime إلى PlaylistPlayer.
  return (
    <PlaylistPlayer
      playlist={playlist}
      initialIndex={initialIndex}
      screenId={screenId}
      scheduleId={scheduleId}
      onRequestRefetch={onRequestRefetch}
      childStartTime={childStartTime}
    />
  );
};

export default SmartPlayer;

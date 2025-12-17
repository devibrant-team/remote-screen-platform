// src/features/schedule/components/SmartPlayer.tsx
import React from "react";
import type { ChildPlaylistResponse, ParentScheduleItem } from "../../types/schedule";
import PlaylistPlayer from "./PlaylistPlayer";

// 👇 Interactive support (web like mobile)
import InteractivePlayer from "./InteractivePlayer";
import type { InteractivePlaylistDTO } from "../../types/interactive";

// (اختياري) Warmup للـ normal playlists
import HeadlessWarmup from "./HeadlessWarmup";

type NormalPlaylistT = ChildPlaylistResponse["playlist"];
type AnyPlaylistT = NormalPlaylistT | InteractivePlaylistDTO;

type Props = {
  playlist: AnyPlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
  childStartTime?: string | null;
  /** NEW: الـ parent schedule الكامل (start_time + end_time) */
  activeSchedule?: ParentScheduleItem;
};

// Detect interactive playlists by style: Interactive1/Interactive2/...
function isInteractivePlaylist(p: AnyPlaylistT): p is InteractivePlaylistDTO {
  const style = (p as any)?.style;
  if (!style) return false;
  const s = String(style).toLowerCase();
  return s.startsWith("interactive");
}

const SmartPlayer: React.FC<Props> = ({
  playlist,
  initialIndex,
  screenId,
  scheduleId,
  onRequestRefetch,
  childStartTime,
  activeSchedule,
}) => {
  // ✅ Interactive playlists
  if (isInteractivePlaylist(playlist)) {
    return (
      <InteractivePlayer
        playlist={playlist}
        initialIndex={initialIndex ?? 0}
        screenId={screenId}
        scheduleId={scheduleId}
        onRequestRefetch={onRequestRefetch}
      />
    );
  }

  // ✅ Normal playlists
  const normal = playlist as NormalPlaylistT;

  return (
    <>
      {/* Optional: warmup videos/media for smoother playback */}
      <HeadlessWarmup
        playlist={normal as any}
        aggressive={true}
        maxMs={120000}
      />

      <PlaylistPlayer
        playlist={normal}
        initialIndex={initialIndex}
        screenId={screenId}
        scheduleId={scheduleId}
        onRequestRefetch={onRequestRefetch}
        childStartTime={childStartTime}
        activeSchedule={activeSchedule}
      />
    </>
  );
};

export default SmartPlayer;

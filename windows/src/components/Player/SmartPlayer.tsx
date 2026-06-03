// src/features/schedule/components/SmartPlayer.tsx
import React from "react";
import type {
  ChildPlaylistResponse,
  ParentScheduleItem,
} from "../../types/schedule";
import PlaylistPlayer from "./PlaylistPlayer";

import InteractivePlayer from "./InteractivePlayer";
import type { InteractivePlaylistDTO } from "../../types/interactive";

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
  serverDate?: string | null;
  activeSchedule?: ParentScheduleItem;
};

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
  serverDate,
  activeSchedule,
}) => {
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

  const normal = playlist as NormalPlaylistT;

  return (
    <>
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
        serverDate={serverDate}
        activeSchedule={activeSchedule}
      />
    </>
  );
};

export default SmartPlayer;

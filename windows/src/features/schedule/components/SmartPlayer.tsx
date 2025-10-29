// src/features/schedule/components/SmartPlayer.tsx
import PlaylistPlayer from "./PlaylistPlayer";
import InteractivePlayer from "./InteractivePlayer";
import { isInteractivePlaylist } from "../../../types/interactive";

export default function SmartPlayer({
  playlist,
  ...rest
}: {
  playlist: any; // ChildPlaylistResponse["playlist"] OR InteractivePlaylistDTO
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
}) {
  if (isInteractivePlaylist(playlist)) {
    return <InteractivePlayer playlist={playlist} {...rest} />;
  }
  return <PlaylistPlayer playlist={playlist} {...rest} />;
}

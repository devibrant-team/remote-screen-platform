// src/pages/HomeScreen.tsx
import "swiper/css";
import "swiper/css/effect-fade";

import React, { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import PlaylistPlayer from "../features/schedule/components/PlaylistPlayer";
import { useScreenId } from "../features/schedule/hooks/useScreenId";
import { echo, ReverbConnection } from "../echo";
import { useResolvedPlaylist } from "../features/schedule/hooks/useResolvedPlaylist";
import { setNowPlaying } from "../utils/playlistCache";

type ScheduleUpdatePayload = { scheduleId?: number | string } & Record<string, unknown>;

const HomeScreen: React.FC = () => {
  const qc = useQueryClient();
  const { screenId } = useScreenId();
  const { activeScheduleId, decision, isLoading, quietRefreshAll } = useResolvedPlaylist(screenId);

  // Keep latest IDs to avoid stale closures
  const latest = useRef<{ screenId?: string | number; scheduleId?: string | number }>({});
  useEffect(() => {
    latest.current = { screenId, scheduleId: activeScheduleId };
  }, [screenId, activeScheduleId]);

  // Persist the playlist that’s actually shown (for offline keep-running case)
  useEffect(() => {
    if (decision.source === "child" || decision.source === "default") {
      setNowPlaying(decision.source, decision.playlist);
    }
  }, [decision.source, decision.playlist]);

  const quietRefresh = async (overrideScheduleId?: number | string | null) => {
    await quietRefreshAll(overrideScheduleId ?? latest.current.scheduleId ?? null);
  };

  // Reverb events
  useEffect(() => {
    if (!screenId) return;
    const channelName = `screens.${screenId}`;
    const channel = echo.channel(channelName);

    const on = (label: string) => async (payload: ScheduleUpdatePayload) => {
      const sid = payload?.scheduleId ?? latest.current.scheduleId ?? null;
      await quietRefresh(sid);
    };

    channel.listen(".ScheduleUpdate", on("ScheduleUpdate"));
    channel.listen(".PlaylistReload", on("PlaylistReload"));

    const off = ReverbConnection.onStatus((s) => {
      if (s === "connected") {
        try { echo.leave(channelName); } catch {}
        const c = echo.channel(channelName);
        c.listen(".ScheduleUpdate", on("ScheduleUpdate"));
        c.listen(".PlaylistReload", on("PlaylistReload"));
      }
    });

    return () => {
      try {
        channel.stopListening(".ScheduleUpdate");
        channel.stopListening(".PlaylistReload");
        echo.leave(channelName);
      } catch {}
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, qc]);

  // UI states
  if (!screenId) {
    return <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">Device not linked.</main>;
  }
  if (isLoading) {
    return <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">Loading…</main>;
  }
  if (!decision.playlist?.slides?.length) {
    return <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">No media available.</main>;
  }

  return (
    <main className="w-screen h-[100dvh] bg-black text-white">
      <PlaylistPlayer
        playlist={decision.playlist}
        screenId={screenId}
        scheduleId={activeScheduleId}
        onRequestRefetch={() => void quietRefresh(null)}
      />
    </main>
  );
};

export default HomeScreen;

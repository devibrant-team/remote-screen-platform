import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { PlaylistSlide, ParentScheduleItem } from "../../types/schedule";
import {
  buildSchedulePlaylistTimeline,
  type SchedulePlaylistTimeline,
} from "../../utils/playlistTimeline";
import {
  selectScheduleTimeline,
  setScheduleTimeline,
} from "../../Redux/scheduleTimelineSlice";
import type { RootState } from "../../../store";

type Args = {
  scheduleId?: number | string;
  schedule?: ParentScheduleItem; // لازم فيها start_time / end_time
  slides?: PlaylistSlide[];
  childStartTime?: string | null;
};

export function useSchedulePlaylistTimeline({
  scheduleId,
  schedule,
  slides = [],
  childStartTime,
}: Args): SchedulePlaylistTimeline | null {
  const dispatch = useDispatch();

  const existing = useSelector((state: RootState) =>
    selectScheduleTimeline(state, scheduleId)
  );
  const endTime = schedule?.end_time;
  const slideKey = useMemo(
    () => JSON.stringify(slides.map((s) => ({ id: s.id, d: s.duration }))),
    [slides]
  );

  useEffect(() => {
    if (!scheduleId || !endTime || !slides.length || !childStartTime) return;

    const timeline = buildSchedulePlaylistTimeline(
      scheduleId,
      slides,
      childStartTime,
      endTime
    );

    dispatch(setScheduleTimeline({ scheduleId, timeline }));
  }, [
    dispatch,
    scheduleId,
    slides,
    endTime,
    childStartTime,
    // لو تغيّرت durations أو ids نعيد البناء
    slideKey,
  ]);

  return existing;
}

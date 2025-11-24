import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { PlaylistSlide, ParentScheduleItem } from "../../../types/schedule";
import {
  buildSchedulePlaylistTimeline,
  type SchedulePlaylistTimeline,
} from "../../../utils/playlistTimeline";
import {
  selectScheduleTimeline,
  setScheduleTimeline,
} from "../../../Redux/scheduleTimelineSlice";
import type { RootState } from "../../../../store";

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

  useEffect(() => {
    if (!scheduleId || !schedule || !slides.length || !childStartTime) return;

    const timeline = buildSchedulePlaylistTimeline(
      scheduleId,
      slides,
      childStartTime,
      schedule.end_time
    );

    dispatch(setScheduleTimeline({ scheduleId, timeline }));
  }, [
    dispatch,
    scheduleId,
    schedule?.end_time,
    childStartTime,
    // لو تغيّرت durations أو ids نعيد البناء
    JSON.stringify(slides.map((s) => ({ id: s.id, d: s.duration }))),
  ]);

  return existing;
}

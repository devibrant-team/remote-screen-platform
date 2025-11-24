import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { SchedulePlaylistTimeline } from "../utils/playlistTimeline";
import type { RootState } from "../../store";

type TimelineState = {
  byScheduleId: Record<string, SchedulePlaylistTimeline>;
};

const initialState: TimelineState = {
  byScheduleId: {},
};

const scheduleTimelineSlice = createSlice({
  name: "scheduleTimeline",
  initialState,
  reducers: {
    setScheduleTimeline(
      state,
      action: PayloadAction<{
        scheduleId: string | number;
        timeline: SchedulePlaylistTimeline | null;
      }>
    ) {
      const { scheduleId, timeline } = action.payload;
      const key = String(scheduleId);

      if (!timeline) {
        delete state.byScheduleId[key];
      } else {
        state.byScheduleId[key] = timeline;
      }
    },
    clearScheduleTimeline(
      state,
      action: PayloadAction<{ scheduleId: string | number }>
    ) {
      delete state.byScheduleId[String(action.payload.scheduleId)];
    },
    clearAllScheduleTimelines(state) {
      state.byScheduleId = {};
    },
  },
});

export const {
  setScheduleTimeline,
  clearScheduleTimeline,
  clearAllScheduleTimelines,
} = scheduleTimelineSlice.actions;

export default scheduleTimelineSlice.reducer;

export const selectScheduleTimeline = (
  state: RootState,
  scheduleId?: string | number | null
): SchedulePlaylistTimeline | null => {
  if (scheduleId == null) return null;
  return state.scheduleTimeline.byScheduleId[String(scheduleId)] ?? null;
};

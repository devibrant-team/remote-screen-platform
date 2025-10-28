import { useMemo } from "react";
import { useActiveSchedule } from "../../../ReactQuery/schedule/useParentSchedules";
import { useChildPlaylist } from "../../../ReactQuery/schedule/useChildPlaylist";

export const LS_SCREEN_ID = "screenId";

export function useScheduleData() {
  const screenId = localStorage.getItem(LS_SCREEN_ID) || undefined;

  const { parent, active, next, activeScheduleId } =
    useActiveSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);

  return useMemo(
    () => ({
      screenId,
      parent, // raw parent response (list for the day)
      active, // the active window object (contains scheduleId)
      next, // next upcoming window (optional)
      activeScheduleId, // number | undefined
      child, // child playlist response
      isLoading: parent.isLoading || child.isLoading,
      isError: parent.isError || child.isError,
    }),
    [screenId, parent, child, active, next, activeScheduleId]
  );
}

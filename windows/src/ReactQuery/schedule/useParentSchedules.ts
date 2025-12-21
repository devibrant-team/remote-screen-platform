// windows/src/ReactQuery/schedule/useParentSchedules.ts
import { useMemo } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { GetParentScheduleApi } from "../../Api/Api";
import type {
  ParentScheduleResponse,
  ParentScheduleItem,
} from "../../types/schedule";
import { qk } from "../../ReactQuery/queryKeys";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import { resolveActiveAndNext } from "../../utils/scheduleTime";

export const LS_TOKEN = "authToken";

export async function fetchParentSchedules(
  screenId: string
): Promise<ParentScheduleResponse> {
  const token = localStorage.getItem(LS_TOKEN) ?? "";
  const { data } = await axios.get<ParentScheduleResponse>(
    `${GetParentScheduleApi}/${screenId}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
  );
  return data;
}

export function useParentSchedules(screenId?: string) {
  return useQuery({
    queryKey: qk.parent(screenId),
    queryFn: () => fetchParentSchedules(screenId as string),
    enabled: !!screenId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });
}

// يلتقط scheduleId سواء scheduleId أو schedule_id أو id
export function pickScheduleId(x: any) {
  return x?.scheduleId ?? x?.schedule_id ?? x?.id ?? null;
}

/** Derives the currently active schedule (by *server* time) + next upcoming */
export function useActiveSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const clock = useServerClockStrict();

  const date = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  // snapshot من ساعة السيرفر
  const nowSec = clock.nowSecs();

const { active, next } = useMemo(() => {
  if (!date)
    return { active: undefined, next: null as ParentScheduleItem | null };

  return resolveActiveAndNext(items, date, nowSec);
}, [date, items, nowSec]);


  const activeScheduleId = active
    ? (pickScheduleId(active) ?? undefined)
    : undefined;

  // OPTIONAL: debug
  useMemo(() => {
    if (!date) return;
    // eslint-disable-next-line no-console
    console.log("[SCHEDULE_DEBUG] useActiveSchedule", {
      date,
      nowSec,
      items: items.map((it) => ({
        scheduleId: pickScheduleId(it),
        start: it.start_time,
        end: it.end_time,
      })),
      activeScheduleId,
      nextScheduleId: next ? pickScheduleId(next) : null,
    });
  }, [date, items, nowSec, activeScheduleId, next]);

  return { parent, active, next, activeScheduleId };
}

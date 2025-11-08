import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { GetParentScheduleApi } from "../../Api/Api";
import type {
  ParentScheduleResponse,
  ParentScheduleItem,
} from "../../types/schedule";
import { pickActiveAndNext } from "../../utils/timeWindow";
import { qk } from "../../ReactQuery/queryKeys";

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

/** Derives the currently active schedule (by time) + next upcoming */
export function useActiveSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const date = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  const { active, next } =
    parent.isSuccess && date
      ? pickActiveAndNext(date, items)
      : { active: undefined, next: null };

  const activeScheduleId = active ? pickScheduleId(active) : undefined;
  return { parent, active, next, activeScheduleId };
}

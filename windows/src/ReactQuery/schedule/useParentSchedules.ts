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

/* ───────── Helpers: HH:mm:ss → ثواني اليوم ───────── */
function toSecs(hms?: string | null) {
  const [h = "0", m = "0", s = "0"] = String(hms ?? "").split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

/** تحديد الـ active و next بناءً على ثواني اليوم حسب السيرفر */
function resolveActiveAndNext(
  items: ParentScheduleItem[],
  nowSec: number
): { active: ParentScheduleItem | undefined; next: ParentScheduleItem | null } {
  if (!items.length) return { active: undefined, next: null };

  const sorted = [...items].sort(
    (a, b) => toSecs(a.start_time) - toSecs(b.start_time)
  );

  let active: ParentScheduleItem | undefined;
  let next: ParentScheduleItem | null = null;

  for (const it of sorted) {
    const start = toSecs(it.start_time);
    const end = toSecs(it.end_time);

    const isInactive = (it as any).status === "inactive";

    // active: الآن بين البداية والنهاية
    if (!isInactive && nowSec >= start && nowSec < end) {
      active = it;
      continue;
    }

    // next: أول بداية مستقبلية بعد الآن
    if (!isInactive && start > nowSec && next == null) {
      next = it;
    }
  }

  return { active, next };
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
    if (!date) return { active: undefined, next: null as ParentScheduleItem | null };
    return resolveActiveAndNext(items, nowSec);
  }, [date, items, nowSec]);

  const activeScheduleId = active ? pickScheduleId(active) ?? undefined : undefined;

  return { parent, active, next, activeScheduleId };
}

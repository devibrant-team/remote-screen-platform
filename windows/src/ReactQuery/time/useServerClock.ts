// src/ReactQuery/time/useServerClock.ts
import { useQuery } from "@tanstack/react-query";
import { qk } from "../queryKeys";
import { fetchTimeClock } from "./fetchTimeClock";
import { calculateOffset, setServerOffset } from "../../utils/serverClock";

/**
 * يهتم بمزامنة ساعة السيرفر كل ساعة عبر React Query.
 * - refetchInterval: ساعة
 * - refetchOnReconnect: نعم
 * - refetchOnWindowFocus: لا
 */
export function useServerClock(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.timeclock(),
    queryFn: fetchTimeClock,
    refetchInterval: 60 * 60 * 1000, // ✅ كل ساعة
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? true,
    onSuccess: (data) => {
      const { t0, t1, serverNowMs, dateHeaderMs } = data;
      const chosen = typeof serverNowMs === "number" ? serverNowMs : dateHeaderMs;
      if (typeof chosen === "number") {
        const off = calculateOffset(t0, chosen, t1);
        setServerOffset(off);
        // console.log("[timeclock] offset updated:", off, "ms");
      }
    },
  });
}

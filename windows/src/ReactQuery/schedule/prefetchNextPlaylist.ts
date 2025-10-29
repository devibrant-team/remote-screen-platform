// src/ReactQuery/schedule/prefetchNextPlaylist.ts
import { QueryClient } from "@tanstack/react-query";
import { fetchChildPlaylist } from "./useChildPlaylist";
import { qk } from "../../ReactQuery/queryKeys";

/** Prefetch next schedule’s playlist into cache. */
export async function prefetchNextPlaylist(
  queryClient: QueryClient,
  nextScheduleId: number | string | undefined,
  screenId?: number | string
) {
  if (!nextScheduleId) return;
  await queryClient.prefetchQuery({
    queryKey: qk.child(nextScheduleId, screenId),
    queryFn: () => fetchChildPlaylist(nextScheduleId, screenId),
    staleTime: 60_000, // treat as fresh for 1 min
  });
}

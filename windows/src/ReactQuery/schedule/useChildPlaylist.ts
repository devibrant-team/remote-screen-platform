import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { GetChildPlaylistApi } from "../../Api/Api";
import type { ChildPlaylistResponse } from "../../types/schedule";
import { LS_TOKEN } from "./useParentSchedules";

/**
 * Backend samples show:
 *   GET /showscheduleplaylist/{scheduleId}
 * and sometimes sending { "screen_id": 66 }.
 * We'll pass screen_id as a query param for GET.
 */
export async function fetchChildPlaylist(
  scheduleId: number | string,
  screenId?: number | string
): Promise<ChildPlaylistResponse> {
  const token = localStorage.getItem(LS_TOKEN) ?? "";
  const { data } = await axios.get<ChildPlaylistResponse>(
    `${GetChildPlaylistApi}/${scheduleId}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: screenId ? { screen_id: screenId } : undefined,
    }
  );
  return data;
}

export function useChildPlaylist(
  scheduleId?: number | string,
  screenId?: number | string
) {
  return useQuery({
    queryKey: ["childPlaylist", scheduleId, screenId],
    queryFn: () => fetchChildPlaylist(scheduleId as number | string, screenId),
    enabled: !!scheduleId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });
}

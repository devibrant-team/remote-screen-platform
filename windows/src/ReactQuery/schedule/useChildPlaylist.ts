// windows/src/ReactQuery/schedule/useChildPlaylist.ts
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { GetChildPlaylistApi } from "../../Api/Api";
import type { ChildPlaylistResponse } from "../../types/schedule";
import { qk } from "../../ReactQuery/queryKeys";

/** Normalize any common server shapes to { playlist: { slides: [...] } } */
function normalizeChildResp(raw: any): ChildPlaylistResponse {
  // A) already normalized: { playlist: { slides: [...] } }
  if (raw?.playlist?.slides) return raw as ChildPlaylistResponse;

  // B) wrapped in data: { data: { playlist: {...} } }
  if (raw?.data?.playlist?.slides) return raw.data as ChildPlaylistResponse;

  // C) direct slides: { slides: [...] }
  if (Array.isArray(raw?.slides))
    return { playlist: raw } as ChildPlaylistResponse;

  // D) nested slides: { data: { slides: [...] } }
  if (Array.isArray(raw?.data?.slides))
    return { playlist: raw.data } as ChildPlaylistResponse;

  // E) sometimes backend returns arrays in playlist fields
  if (Array.isArray(raw?.playlist))
    return { playlist: { slides: raw.playlist } } as ChildPlaylistResponse;
  if (Array.isArray(raw?.data?.playlist))
    return { playlist: { slides: raw.data.playlist } } as ChildPlaylistResponse;

  // Fallback
  return raw as ChildPlaylistResponse;
}

/**
 * GET /showscheduleplaylist/{scheduleId}?screen_id=...
 */
export async function fetchChildPlaylist(
  scheduleId: number | string,
  screenId?: number | string
): Promise<ChildPlaylistResponse> {
    const token = localStorage.getItem("authToken") ?? "";
  const { data } = await axios.get(`${GetChildPlaylistApi}/${scheduleId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    params: screenId ? { screen_id: screenId } : undefined,
  });
  return normalizeChildResp(data);
}

export function useChildPlaylist(
  scheduleId?: number | string,
  screenId?: number | string
) {
  return useQuery({
    queryKey: qk.child(scheduleId, screenId),
    queryFn: () => fetchChildPlaylist(scheduleId as number | string, screenId),
    enabled: !!scheduleId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });
}

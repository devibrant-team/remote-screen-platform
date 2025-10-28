import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { DefaultPlayListApi } from "../../Api/Api";
import type { ChildPlaylistResponse } from "../../types/schedule";
import { LS_TOKEN } from "./useParentSchedules";

/** Normalizes any known server shape to ChildPlaylistResponse */
function normalizeDefaultResp(raw: any): ChildPlaylistResponse {
  // Case A: already in expected shape { playlist: { slides: [...] } }
  if (raw?.playlist?.slides) return raw as ChildPlaylistResponse;

  // Case B: wrapped: { data: { playlist: {...} } }
  if (raw?.data?.playlist?.slides) return raw.data as ChildPlaylistResponse;

  // Case C: direct slides: { slides: [...] }
  if (Array.isArray(raw?.slides)) return { playlist: raw } as ChildPlaylistResponse;

  // Case D: nested: { data: { slides: [...] } }
  if (Array.isArray(raw?.data?.slides)) return { playlist: raw.data } as ChildPlaylistResponse;

  // Fallback: return what we got; downstream will treat as "no slides"
  return raw as ChildPlaylistResponse;
}

/** GET /showsdefault/{screenId} */
export async function fetchDefaultPlaylist(
  screenId: number | string
): Promise<ChildPlaylistResponse> {
  const token = localStorage.getItem(LS_TOKEN) ?? "";
  const { data } = await axios.get(
    `${DefaultPlayListApi}/${screenId}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
  );
  return normalizeDefaultResp(data);
}

/**
 * Pass `enabled` true to auto-fetch when we "want" default.
 * This avoids manual refetch races.
 */
export function useDefaultPlaylist(
  screenId?: number | string,
  enabled = false
) {
  return useQuery({
    queryKey: ["defaultPlaylist", screenId],
    queryFn: () => fetchDefaultPlaylist(screenId as number | string),
    enabled: !!screenId && enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  });
}

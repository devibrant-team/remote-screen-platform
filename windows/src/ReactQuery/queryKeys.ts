// src/ReactQuery/queryKeys.ts
export const qk = {
  parent: (screenId?: string | number | undefined) =>
    ["parentSchedules", screenId] as const,
  child: (
    scheduleId?: string | number | undefined,
    screenId?: string | number | undefined
  ) => ["childPlaylist", scheduleId, screenId] as const,
  def: (screenId?: string | number | undefined) =>
    ["defaultPlaylist", screenId] as const,
};

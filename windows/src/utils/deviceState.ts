// src/utils/deviceState.ts
export const LS_SCREEN_ID = "screenId";
export const LS_LINKED = "linked";
export const LS_TOKEN = "authToken";

export async function loadDeviceState() {
  const api = (window as any)?.signage;

  // 1) جرّب Electron أولاً
  try {
    if (api?.getDeviceState) {
      const s = await api.getDeviceState(); // { screenId?: string, linked?: boolean }
      if (s?.screenId) {
        return {
          screenId: String(s.screenId),
          linked: Boolean(s.linked),
          token: localStorage.getItem(LS_TOKEN) || undefined,
        };
      }
    }
  } catch {/* ignore */}

  // 2) fallback إلى localStorage
  const screenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
  const linked = localStorage.getItem(LS_LINKED) === "1";
  const token = localStorage.getItem(LS_TOKEN) || undefined;

  return { screenId, linked, token };
}
export function loadDeviceStateSync() {
  const screenId = localStorage.getItem("screenId") || undefined;
  const linked = localStorage.getItem("linked") === "1";
  const token = localStorage.getItem("authToken") || undefined;

  return { screenId, linked, token };
}

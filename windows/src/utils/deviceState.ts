// src/utils/deviceState.ts
export const LS_SCREEN_ID = "screenId";
export const LS_LINKED = "linked";
export const LS_TOKEN = "authToken";

export async function getAuthToken(): Promise<string | undefined> {
  const api = window.signage;
  if (api?.getAuthToken) {
    const stored = await api.getAuthToken();
    if (stored) return stored;

    // Migrate credentials from versions that stored tokens in localStorage.
    const legacy = localStorage.getItem(LS_TOKEN);
    if (!legacy) return undefined;
    await saveAuthToken(legacy);
    return legacy;
  }
  return localStorage.getItem(LS_TOKEN) || undefined;
}

export async function saveAuthToken(token: string): Promise<void> {
  const api = window.signage;
  if (api?.saveAuthToken) {
    const result = await api.saveAuthToken(token);
    if (result?.ok !== true) throw new Error("Secure authentication token storage failed");
    localStorage.removeItem(LS_TOKEN);
    return;
  }
  localStorage.setItem(LS_TOKEN, token);
}

export async function clearAuthToken(): Promise<void> {
  const api = window.signage;
  if (api?.clearAuthToken) await api.clearAuthToken();
  localStorage.removeItem(LS_TOKEN);
}

export async function loadDeviceState() {
  const api = (window as any)?.signage;

  // 1) جرّب Electron أولاً
  try {
    if (api?.getDeviceState) {
      const s = await api.getDeviceState();
      if (s?.screenId) {
        const linked = s.linked ?? (localStorage.getItem(LS_LINKED) === "1");
        if (s.linked == null && linked) await api.setLinked?.(true);
        return {
          screenId: String(s.screenId),
          linked: Boolean(linked),
          token: await getAuthToken(),
        };
      }
    }
  } catch {/* ignore */}

  // 2) fallback إلى localStorage
  const screenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
  const linked = localStorage.getItem(LS_LINKED) === "1";
  const token = await getAuthToken();

  return { screenId, linked, token };
}
export function loadDeviceStateSync() {
  const screenId = localStorage.getItem("screenId") || undefined;
  const linked = localStorage.getItem("linked") === "1";
  return { screenId, linked };
}

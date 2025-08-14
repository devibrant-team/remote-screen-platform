// src/types/preload.d.ts
export {};

declare global {
  interface Window {
    signage: {
      getDeviceState: () => Promise<{ code?: number | string; screenId?: string }>;
      saveScreenId: (screenId: string) => Promise<{ ok: boolean }>;
      resetDevice: () => Promise<{ ok: boolean }>;
    };
  }
}

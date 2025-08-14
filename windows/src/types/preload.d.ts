export {};

declare global {
  interface Window {
    signage: {
      getDeviceState: () => Promise<{ code?: string; screenId?: string }>;
      saveScreenId: (screenId: string) => Promise<{ ok: boolean }>;
      resetDevice: () => Promise<{ ok: boolean }>;
    };
  }
}

// src/types/preload.d.ts
export {};

declare global {
  interface Window {
    signage: {
      getDeviceState: () => Promise<{ code?: number | string; screenId?: string; linked?: boolean }>;
      saveScreenId: (screenId: string) => Promise<{ ok: boolean }>;
      setLinked: (linked: boolean) => Promise<{ ok: boolean }>;
      getAuthToken: () => Promise<string | undefined>;
      saveAuthToken: (token: string) => Promise<{ ok: boolean }>;
      clearAuthToken: () => Promise<{ ok: boolean }>;
      resetDevice: () => Promise<{ ok: boolean }>;
      getClockCalibration?: () => Promise<any>;
      saveClockCalibration?: (cal: any) => Promise<{ ok: boolean }>;
      onPowerResume?: (cb: () => void) => () => void;
    };
    iguana: {
      pingServer: (address: string, port: number) => Promise<boolean>;
    };
    serverConfig: {
      configureMediaProxy: (host: string, port: number) => Promise<{ ok: boolean }>;
    };
  }
}

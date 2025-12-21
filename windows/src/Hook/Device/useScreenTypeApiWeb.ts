// src/Hook/Device/useScreenTypeApiWeb.ts
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { GetRotationApi } from "../../Api/Api";
import { applyScreenTypeWeb, type ScreenType } from "../../utils/applyScreenTypeWeb";
import { loadDeviceState } from "../../utils/deviceState";

type RotationApiReply = {
  success?: boolean;
  type?: string; // portrait | landscape
};

function normalizeType(v: any): ScreenType {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return "";
  if (t === "portrait") return "portrait";
  if (t === "landscape") return "landscape";
  return t;
}

async function fetchRotationType(screenCode: string): Promise<ScreenType> {
  // ✅ get token from device state (Electron → localStorage fallback)
  const { token } = await loadDeviceState();

  const url = `${GetRotationApi}${encodeURIComponent(screenCode)}`;

  const { data } = await axios.get<RotationApiReply>(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!data?.success) return "";
  return normalizeType(data?.type);
}

export function useScreenTypeApiWeb() {
  const [screenType, setScreenType] = useState<ScreenType>("");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      // ✅ get screenId/code from device state
      const { screenId } = await loadDeviceState();
      if (!screenId) return;

      try {
        const apiType = await fetchRotationType(screenId);
        if (!mounted.current) return;

        if (apiType) {
          setScreenType(apiType);
          applyScreenTypeWeb(apiType);
          console.log("[ScreenType] ✅ Applied from API:", apiType);
        }
      } catch (e) {
        console.warn("[ScreenType] API failed", e);
      }
    })();
  }, []);

  return { screenType };
}

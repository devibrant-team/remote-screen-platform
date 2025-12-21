import { useEffect, useRef, useState } from "react";
import { subscribeScreenTypeChannel, type ScreenType, ReverbConnection } from "../../echo";
import { applyScreenTypeWeb } from "../../utils/applyScreenTypeWeb";
import { loadDeviceState } from "../../utils/deviceState";

export function useScreenTypeReverbWeb() {
  const [screenType, setScreenType] = useState<ScreenType>("");
  const [screenCode, setScreenCode] = useState<string>("");

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let unsub: null | (() => void) = null;

    (async () => {
      const { screenId } = await loadDeviceState();

      const code = String(screenId ?? "").trim(); // ✅ screenCode = screenId

      if (!code) {
        console.warn("[ScreenType] No screenId found in deviceState (Web)");
        return;
      }

      if (!mounted.current) return;
      setScreenCode(code);

      console.log("[ScreenType] ✅ screenCode(screenId) =", code);
      console.log("[ScreenType] reverb status:", ReverbConnection.status);

      unsub = subscribeScreenTypeChannel(code, (type, payload) => {
        console.log("[ScreenType] 📩 Reverb callback (Web):", { type, payload });

        if (!type) return;
        if (!mounted.current) return;

        setScreenType(type);

        console.log("[ScreenType] 🔄 applying web screen type:", type);
        applyScreenTypeWeb(type);
        console.log("[ScreenType] ✅ applied (Web):", type);
      });
    })();

    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  return { screenType, screenCode };
}

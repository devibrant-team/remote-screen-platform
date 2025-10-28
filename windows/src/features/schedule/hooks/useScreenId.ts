// src/hooks/useScreenId.ts
import { useEffect, useState } from "react";
import { loadDeviceState } from "../../../utils/deviceState";

export function useScreenId() {
  const [state, setState] = useState<{screenId?: string; linked?: boolean; token?: string}>({});

  useEffect(() => {
    let alive = true;
    loadDeviceState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  return state; // { screenId, linked, token }
}

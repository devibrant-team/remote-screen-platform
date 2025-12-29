// src/hooks/useScreenRefreshReverbWeb.ts
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeScreenRefreshChannel } from "../../echo"; // عدّل المسار حسب مشروعك

const LS_SCREEN_ID = "screenId";
const LS_LAST_RELOAD_AT = "lastHardReloadAt";

function canHardReload(cooldownMs = 8000): boolean {
  const lastStr = localStorage.getItem(LS_LAST_RELOAD_AT);
  const last = lastStr ? Number(lastStr) || 0 : 0;

  const now = Date.now();
  if (now - last < cooldownMs) return false;

  localStorage.setItem(LS_LAST_RELOAD_AT, String(now));
  return true;
}

async function invalidateScheduleQueriesWeb(qc: any, screenId: string) {
  // عدّل keys حسب مشروعك
  await qc.invalidateQueries({ queryKey: ["schedule", screenId] }).catch(() => {});
  await qc.invalidateQueries({ queryKey: ["playlist", screenId] }).catch(() => {});
  await qc.invalidateQueries({ queryKey: ["screen", screenId] }).catch(() => {});
}

function forceReloadWeb(reason?: string) {
  console.log("[WebRefresh] 🔁 forceReload", reason ?? "");
  window.location.reload(); // full reload
}

export function useScreenRefreshReverbWeb() {
  const qc = useQueryClient();
  const [showRefreshing, setShowRefreshing] = useState(false);

  const unsubRef = useRef<null | (() => void)>(null);
  const firedRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;

    const screenId = String(localStorage.getItem(LS_SCREEN_ID) ?? "").trim();
    if (!screenId) {
      console.log("[WebRefresh] no screenId in localStorage, skip");
      return;
    }

    unsubRef.current = subscribeScreenRefreshChannel(screenId, async (payload) => {
      if (!alive) return;
      if (firedRef.current) return;
      firedRef.current = true;

      const ok = canHardReload(8000);
      if (!ok) {
        console.log("[WebRefresh] skip reload (cooldown)", { screenId, payload });
        firedRef.current = false;
        return;
      }

      setShowRefreshing(true);

      try {
        await invalidateScheduleQueriesWeb(qc, screenId);
      } catch {}

      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        setShowRefreshing(false);
        firedRef.current = false;
      }, 6000);

      await new Promise((r) => setTimeout(r, 250));
      forceReloadWeb("Reverb ScreenRefresh");
    });

    return () => {
      alive = false;

      try {
        unsubRef.current?.();
      } catch {}
      unsubRef.current = null;

      firedRef.current = false;

      if (watchdogRef.current) window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;

      setShowRefreshing(false);
    };
  }, [qc]);

  return { showRefreshing };
}

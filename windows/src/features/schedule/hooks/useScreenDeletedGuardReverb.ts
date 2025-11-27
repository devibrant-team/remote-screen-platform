// src/features/schedule/hooks/useScreenDeletedGuard.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { echo } from "../../../echo";
import { clearAllIguanaCaches } from "../../../utils/resetCaches";

function handleScreenDeletedGlobal(screenId: string | number) {
  console.log("[ScreenGuard] 🚨 handleScreenDeletedGlobal:", {
    screenId,
  });

  // kiosk-style redirect → شاشة الإنشاء
  try {
    const base = window.location.origin + window.location.pathname;
    const target = `${base}#/register`;
    console.log("[ScreenGuard] 🔁 Navigating to:", target);
    window.location.replace(target);
  } catch (e) {
    console.warn("[ScreenGuard] ⚠ navigation error", e);
    window.location.hash = "#/register";
  }
}

export function useScreenDeletedGuardReverb(
  screenId: string | number | null | undefined
) {
  const qc = useQueryClient();

  useEffect(() => {
    // لو ما في screenId → ما نعمل شي
    if (screenId == null) return;

    const idStr = String(screenId);
    const channelName = `screens.${idStr}`;

    console.log("[ScreenGuard] 👂 Mount guard for screen:", {
      screenId: idStr,
      channelName,
    });

    const channel = echo.channel(channelName);

    const onDeleted = (data: any) => {
      console.log("[ScreenGuard] 🧨 ScreenDeleted EVENT:", {
        channelName,
        data,
      });

      // 🧹 امسح كل الكاشات (نفس reset تبع الـ API guard)
      clearAllIguanaCaches(qc).catch(() => {});
      handleScreenDeletedGlobal(idStr);
    };

    console.log(
      "[ScreenGuard] 🎧 Listening for .ScreenDeleted on",
      channelName
    );
    channel.listen(".ScreenDeleted", onDeleted);

    return () => {
      console.log("[ScreenGuard] 🧽 cleanup guard for:", channelName);
      try {
        channel.stopListening(".ScreenDeleted", onDeleted);
        echo.leave(channelName);
      } catch {}
    };
  }, [screenId, qc]);
}

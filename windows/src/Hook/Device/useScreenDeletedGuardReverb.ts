// src/features/schedule/hooks/useScreenDeletedGuard.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { echo } from "../../echo";
import { clearAllIguanaCaches } from "../../utils/resetCaches";

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
  if (!screenId) {
    console.log("[Del] ❌ No screenId yet, skipping subscription");
    return;
  }

  const DeleteChannel = `screenDel.${screenId}`;
  console.log("[Del] 🔔 Subscribing to delete channel:", DeleteChannel);

  const channelDel = echo.channel(DeleteChannel);

  channelDel.subscribed(() => {
    console.log("[Del] ✅ Subscribed to", DeleteChannel);
  });

  const handler = (event: any) => {
    console.log("[Del] 🔥 ScreenDeleted event received:", {
      channel: DeleteChannel,
      payload: event,
    });
    alert("Screen was deleted on the server.");

    clearAllIguanaCaches(qc).catch(() => {});
      handleScreenDeletedGlobal(screenId);
  };

  // IMPORTANT: use `.ScreenDeleted` because you used broadcastAs()
  channelDel.listen(".ScreenDeleted", handler);

  // Cleanup
  return () => {
    console.log("[Del] 🧹 Cleanup delete channel:", DeleteChannel);
    try {
      channelDel.stopListening(".ScreenDeleted"); // no handler argument
      echo.leave(DeleteChannel);
    } catch (err) {
      console.warn("[Del] cleanup error", err);
    }
  };
}, [screenId , qc]);
}

// src/features/schedule/hooks/useScreenDeletedGuard.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { echo } from "../../echo";
import { clearAllIguanaCaches } from "../../utils/resetCaches";
import { toastAlert } from "../../utils/toastAlert";

function handleScreenDeletedGlobal(screenId: string | number) {
  console.log("[ScreenGuard] 🚨 handleScreenDeletedGlobal:", { screenId });

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

    const handler = async (event: any) => {
      console.log("[Del] 🔥 ScreenDeleted event received:", {
        channel: DeleteChannel,
        payload: event,
      });

      // ✅ toast بدل alert
      toastAlert(
        "This screen was deleted on the server.\nRedirecting to registration…",
        "error",
        { id: "screen-deleted" } // يمنع التكرار
      );

      try {
        await clearAllIguanaCaches(qc);
      } catch {}

      handleScreenDeletedGlobal(screenId);
    };

    channelDel.listen(".ScreenDeleted", handler);

    return () => {
      console.log("[Del] 🧹 Cleanup delete channel:", DeleteChannel);
      try {
        channelDel.stopListening(".ScreenDeleted"); // no handler argument
        echo.leave(DeleteChannel);
      } catch (err) {
        console.warn("[Del] cleanup error", err);
      }
    };
  }, [screenId, qc]);
}

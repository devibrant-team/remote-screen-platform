// src/hooks/useScreenCheckGuard.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckScreenApi } from "../../Api/Api";
import { useScreenId } from "./useScreenId";
import { clearAllIguanaCaches } from "../../utils/resetCaches";

export function useScreenCheckGuardApi() {
  const { screenId } = useScreenId();
  const qc = useQueryClient();

  useEffect(() => {
    // لو undefined أو null → ما نعمل شي
    if (screenId == null) return;

    const idStr = String(screenId);

    (async () => {
      try {
        const url = `${CheckScreenApi()}${idStr}`;
        console.log("[ScreenCheck] 🔍 single check:", url);

        const res = await fetch(url, { method: "GET" });
        const json = await res.json();

        console.log("[ScreenCheck] 🔍 API response:", json);

        // لو الـ API قال إن الشاشة مش موجودة
        if (!json?.success) {
          console.log(
            "[ScreenCheck] ❌ screen not found → CLEAR CACHES + redirect"
          );

          // 1) امسح كل الكاشات (React Query + localStorage + SW + bridge)
          try {
            await clearAllIguanaCaches(qc);
            console.log("[ScreenCheck] 🧹 clearAllIguanaCaches done");
          } catch (e) {
            console.warn("[ScreenCheck] clearAllIguanaCaches error", e);
          }

          // 2) حوّل على صفحة الإنشاء /register
          try {
            const base = window.location.origin + window.location.pathname;
            const target = `${base}#/register`;
            console.log("[ScreenCheck] 🔁 Navigating to:", target);
            window.location.replace(target);
          } catch (e) {
            console.warn("[ScreenCheck] navigation error", e);
            window.location.hash = "#/register";
          }
        } else {
          console.log(
            "[ScreenCheck] ✅ screen exists (success: true) – no action"
          );
        }
      } catch (e) {
        console.warn("[ScreenCheck] ⚠ checkscreen request failed", e);
      }
    })();
  }, [screenId, qc]);
}

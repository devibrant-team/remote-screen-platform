// src/utils/serverClockToast.ts
export type ToastKind = "info" | "success" | "warning" | "error";

export function showServerToast(message: string, kind: ToastKind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("server-clock-toast", {
      detail: { message, kind },
    } as any)
  );
}

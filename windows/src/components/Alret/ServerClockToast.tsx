// src/components/ServerClockToast.tsx
import React, { useEffect, useState } from "react";

type ToastKind = "info" | "success" | "warning" | "error";

type ToastPayload = {
  message: string;
  kind?: ToastKind;
};

type ToastState = {
  message: string;
  kind: ToastKind;
};

const kindStyles: Record<ToastKind, string> = {
  info: "border-sky-400 bg-slate-800/90",
  success: "border-emerald-400 bg-slate-800/90",
  warning: "border-amber-400 bg-slate-800/90",
  error: "border-rose-500 bg-slate-800/90",
};

const kindLabel: Record<ToastKind, string> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  error: "Error",
};

/**
 * ضع هذا الكومبوننت مرة واحدة في مكان عالي (مثلاً HomeScreen أو App)
 * وسيستمع لأحداث window "server-clock-toast" ويعرض toast لمدة 10 ثواني.
 */
export function ServerClockToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  // استماع لأحداث التوست
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;
      setToast({
        message: detail.message,
        kind: detail.kind ?? "info",
      });
    };

    window.addEventListener("server-clock-toast", handler as any);
    return () => {
      window.removeEventListener("server-clock-toast", handler as any);
    };
  }, []);

  // إخفاء تلقائي بعد 10 ثوانٍ
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => {
      setToast(null);
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  const style = kindStyles[toast.kind];
  const label = kindLabel[toast.kind];

  return (
    <div className="pointer-events-none fixed inset-0 flex items-end justify-center sm:items-end sm:justify-center z-[9999]">
      <div
        className={`mb-6 max-w-md rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm text-white ${style} pointer-events-auto`}
      >
        <div className="flex gap-3 items-start">
          <div className="mt-0.5 h-2 w-2 rounded-full bg-current" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide opacity-70">
              {label}
            </div>
            <div className="mt-1 text-sm leading-relaxed">{toast.message}</div>
          </div>
        </div>
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 bg-white/40" />
        </div>
      </div>
    </div>
  );
}

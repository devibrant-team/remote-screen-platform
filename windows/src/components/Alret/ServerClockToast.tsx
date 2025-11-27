// src/components/ServerClockToast.tsx
import React, { useEffect, useState } from "react";

type ToastKind = "info" | "success" | "warning" | "error";

type ToastPayload = {
  message: string;
  kind?: ToastKind;
};

type ToastInstance = {
  id: number;
  message: string;
  kind: ToastKind;
  visible: boolean;
};

const red500 = "#ef4444";
const green500 = "#22c55e";
const amber500 = "#f59e0b";
const blue500 = "#3b82f6";

const kindColor: Record<ToastKind, string> = {
  info: blue500,
  success: green500,
  warning: amber500,
  error: red500,
};

const kindLabel: Record<ToastKind, string> = {
  info: "INFO",
  success: "SUCCESS",
  warning: "WARNING",
  error: "ERROR",
};

let toastIdCounter = 1;

export function ServerClockToast() {
  const [toasts, setToasts] = useState<ToastInstance[]>([]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;

      const id = toastIdCounter++;
      const kind: ToastKind = detail.kind ?? "info";

      // vibration
      if (navigator?.vibrate) {
        if (kind === "error") navigator.vibrate([120, 40, 120]);
        else if (kind === "warning") navigator.vibrate(80);
        else navigator.vibrate(40);
      }

      // Add toast
      setToasts((prev) => [
        ...prev,
        { id, message: detail.message, kind, visible: true },
      ]);

      // fade-out at 9.7 sec
      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, visible: false } : t
          )
        );
      }, 9700); // fade starts at 9.7 sec

      // remove fully at EXACT 10 sec
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 10000);
    };

    window.addEventListener("server-clock-toast", handler as any);
    return () =>
      window.removeEventListener("server-clock-toast", handler as any);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center z-[99999]">
      <div className="flex flex-col gap-4 items-center max-w-md w-[90%] sm:w-auto">
        {toasts.map((toast) => {
          const color = kindColor[toast.kind];
          return (
            <div
              key={toast.id}
              className={`
                pointer-events-auto w-full
                transition-all duration-300
                ${toast.visible ? "opacity-100 scale-100" : "opacity-0 scale-95 translate-y-1"}
              `}
              style={{
                animation: toast.visible
                  ? "toastIn 0.25s ease-out"
                  : undefined,
              }}
            >
              <div
                className="rounded-2xl shadow-xl backdrop-blur-md border px-5 py-4"
                style={{
                  background: "#ffffffcc",
                  borderColor: color,
                }}
              >
                <div className="flex gap-3 items-start">
                  <div
                    className="h-3 w-3 rounded-full mt-1"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1">
                    <div
                      className="text-xs font-semibold tracking-wide"
                      style={{ color, opacity: 0.9 }}
                    >
                      {kindLabel[toast.kind]}
                    </div>
                    <div className="mt-1 text-base leading-relaxed font-medium text-black">
                      {toast.message}
                    </div>
                  </div>
                </div>

                <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full"
                    style={{
                      width: "35%",
                      backgroundColor: color,
                      opacity: 0.4,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>
        {`
          @keyframes toastIn {
            from { opacity: 0; transform: scale(0.92); }
            to { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
    </div>
  );
}

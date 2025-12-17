// src/utils/toastAlert.ts
import toast from "react-hot-toast";

type ToastKind = "success" | "error" | "info";

const baseStyle = {
  minWidth: "320px",
  lineHeight: 1.4,
};

export function toastAlert(
  message: string,
  kind: ToastKind = "info",
  opts?: Parameters<typeof toast>[1]
) {
  const styleByKind: Record<ToastKind, React.CSSProperties> = {
    success: {
      borderLeft: "6px solid #22c55e",
    },
    error: {
      borderLeft: "6px solid #ef4444",
    },
    info: {
      borderLeft: "6px solid #3b82f6",
    },
  };

  return toast(message, {
    style: {
      ...baseStyle,
      ...styleByKind[kind],
    },
    ...opts,
  });
}

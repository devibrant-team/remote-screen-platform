// src/components/ScreenRefreshOverlay.tsx
import React from "react";
import { RefreshCw } from "lucide-react";

type Props = {
  show: boolean;
  text?: string;
};

export default function ScreenRefreshOverlay({ show, text }: Props) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60">
      <div className="rounded-2xl border border-white/10 bg-zinc-900/90 px-5 py-4 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5">
            <RefreshCw className="h-5 w-5 animate-spin text-white" />
          </div>

          <div className="min-w-[220px]">
            <div className="text-sm font-semibold text-white">Refreshing…</div>
            <div className="mt-0.5 text-xs text-white/70">
              {text ?? "Applying latest updates"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

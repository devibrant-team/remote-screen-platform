// src/App.tsx
import { HashRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import toast, { Toaster } from "react-hot-toast";

import CreateScreen from "./Screen/CreateScreen";
import HomeScreen from "./Screen/HomeScreen";
import { useStatusHeartbeat } from "./Hook/Device/useStatusHeartbeat";
import { useScreenCheckGuardApi } from "./Hook/Device/useScreenCheckGuardApi";
import { ServerClockToast } from "./components/Alret/ServerClockToast";

// ✅ Screen type hooks
import { useScreenTypeApiWeb } from "./Hook/Device/useScreenTypeApiWeb";
import { useScreenTypeReverbWeb } from "./Hook/Device/useScreenTypeReverbWeb";

// ✅ Screen refresh overlay (Tailwind)
import ScreenRefreshOverlay from "./components/Alret/ScreenRefreshOverlay";
import { useScreenRefreshReverbWeb } from "./Hook/Device/useScreenRefreshReverbWeb";

import "./index.css";

const UPDATE_TOAST_ID = "app-update-toast";

function showUpdateToast(message: string) {
  toast.loading(message, { id: UPDATE_TOAST_ID });
}

function showUpdateProgress(percent: number) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));

  toast.loading(
    <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">Downloading update…</div>
        <div className="tabular-nums">{p}%</div>
      </div>

      <div className="mt-3 h-2 w-full rounded-full bg-white/15 overflow-hidden">
        <div
          className="h-full rounded-full bg-white"
          style={{ width: `${p}%` }}
        />
      </div>

      <div className="mt-2 text-sm opacity-80">Please don’t close the app.</div>
    </div>,
    { id: UPDATE_TOAST_ID }
  );
}

function closeUpdateToast() {
  toast.dismiss(UPDATE_TOAST_ID);
}

export default function App() {
  useStatusHeartbeat();
  useScreenCheckGuardApi();

  // ✅ Apply initial type from API then listen live from Reverb
  useScreenTypeApiWeb();
  useScreenTypeReverbWeb();

  // ✅ Listen ScreenRefresh + show overlay
  const { showRefreshing } = useScreenRefreshReverbWeb();

  useEffect(() => {
    const w = window as any;
    if (!w.updater?.onEvent) return;

    let lastShownPercent = -1;

    const off = w.updater.onEvent((e: any) => {
      if (!e?.type) return;

      if (e.type === "checking") {
        showUpdateToast("Checking for updates…");
        return;
      }

      if (e.type === "available") {
        showUpdateToast("Update available. Starting download…");
        return;
      }

      if (e.type === "none") {
        closeUpdateToast();
        // optional: keep this or remove it
        toast.success("You’re up to date.");
        return;
      }

      if (e.type === "progress") {
        const p = Math.round(e.percent || 0);

        // ✅ reduce UI spam (some updaters emit MANY progress events)
        if (p === lastShownPercent) return;
        lastShownPercent = p;

        showUpdateProgress(p);
        return;
      }

      if (e.type === "downloaded") {
        toast.success("Update downloaded. Installing…", { id: UPDATE_TOAST_ID });
        // small delay so user sees the “Installing…” state
        setTimeout(() => w.updater.install(), 600);
        return;
      }

      if (e.type === "error") {
        toast.error(`Update error: ${e.message || "Unknown error"}`, {
          id: UPDATE_TOAST_ID,
        });
        return;
      }
    });

    return off;
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden">
      {/* ✅ Refresh UI overlay */}
      <ScreenRefreshOverlay show={showRefreshing} text="Updating screen…" />

      <Toaster
        position="top-center"
        containerStyle={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
        toastOptions={{
          duration: 5000, // ✅ keep update toast “sticky”; we dismiss manually
          style: {
            background: "rgba(20, 20, 20, 0.95)",
            color: "#fff",
            padding: "18px 22px",
            fontSize: "16px",
            fontWeight: 600,
            borderRadius: "14px",
            boxShadow:
              "0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
            maxWidth: "92vw",
            textAlign: "left",
            minWidth: "360px",
            lineHeight: 1.35,
          },
        }}
      />

      <ServerClockToast />

      <HashRouter>
        <CreateScreen />

        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/register" element={<CreateScreen />} />
        </Routes>
      </HashRouter>
    </div>
  );
}

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

import "./index.css";

export default function App() {
  useStatusHeartbeat();
  useScreenCheckGuardApi();

  // ✅ Apply initial type from API then listen live from Reverb
  useScreenTypeApiWeb();
  useScreenTypeReverbWeb();

  useEffect(() => {
    const w = window as any;
    if (!w.updater?.onEvent) return;

    const off = w.updater.onEvent((e: any) => {
      if (!e?.type) return;

      if (e.type === "checking") toast("Checking for updates...");
      if (e.type === "available") toast("Update available. Downloading...");
      if (e.type === "none") toast("No updates available.");
      if (e.type === "progress") {
        toast(`Downloading... ${Math.round(e.percent || 0)}%`);
      }
      if (e.type === "downloaded") {
        toast.success("Update downloaded. Restarting to install...");
        w.updater.install();
      }
      if (e.type === "error") toast.error(`Update error: ${e.message}`);
    });

    return off;
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden">
      <Toaster
        position="top-center"
        containerStyle={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
        toastOptions={{
          duration: 4000,
          style: {
            background: "rgba(20, 20, 20, 0.95)",
            color: "#fff",
            padding: "20px 28px",
            fontSize: "18px",
            fontWeight: 600,
            borderRadius: "14px",
            boxShadow:
              "0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
            maxWidth: "90vw",
            textAlign: "center",
            minWidth: "320px",
            lineHeight: 1.4,
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

// src/App.tsx
import { HashRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
import { clearServerIp, getServerIp, saveServerIp } from "./config/serverConfig";

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

function ServerConfigScreen() {
  const [serverIp, setServerIp] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serverIp.trim()) return;
    saveServerIp(serverIp);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 px-6 text-white">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-white/10 bg-zinc-900 p-6 shadow-2xl"
      >
        <h1 className="text-xl font-semibold">Server IP / Host</h1>
        <input
          autoFocus
          value={serverIp}
          onChange={(event) => setServerIp(event.target.value)}
          placeholder="192.168.1.10"
          className="mt-5 w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-3 text-base text-white outline-none focus:border-white/40"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-white px-4 py-3 font-semibold text-zinc-950"
        >
          Save
        </button>
      </form>
    </div>
  );
}

function AppShell() {
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
      <button
        type="button"
        onClick={clearServerIp}
        className="fixed right-4 top-4 z-50 rounded-md bg-black/70 px-3 py-2 text-sm font-semibold text-white shadow-lg"
      >
        Change Server
      </button>

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

export default function App() {
  if (!getServerIp()) return <ServerConfigScreen />;
  return <AppShell />;
}

import React from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../store";

const pill = (ok: boolean) =>
  ok
    ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
    : "bg-amber-100 text-amber-700 ring-1 ring-amber-200";

export default function HomeScreen() {
  const screenId = useSelector((s: RootState) => s.app.screenId);
  const code = useSelector((s: RootState) => s.app.code);

  const lsLinked = typeof window !== "undefined" && localStorage.getItem("linked") === "1";
  const lsScreenId = typeof window !== "undefined" ? localStorage.getItem("screenId") ?? "—" : "—";
  const lsCode = typeof window !== "undefined" ? localStorage.getItem("code") ?? "—" : "—";

  const isRegistered = Boolean(screenId ?? lsScreenId !== "—");
  const isLinked = lsLinked;

  return (
<main className="w-full h-full min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Header (full width) */}
      <header className="w-full px-8 py-6 border-b bg-white/70 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Device Dashboard</h1>
            <p className="text-sm text-slate-600">Status & diagnostics for this screen</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-sm ${pill(isRegistered)}`}>
              {isRegistered ? "Registered" : "Not Registered"}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm ${pill(isLinked)}`}>
              {isLinked ? "Linked" : "Waiting to Link"}
            </span>
          </div>
        </div>
      </header>

      {/* Content (full width grid) */}
      <section className="w-full px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Identity card */}
          <div className="lg:col-span-4 p-6 rounded-2xl border bg-white shadow-sm">
            <h2 className="text-lg font-semibold">Identity</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Redux screenId</dt>
                <dd className="font-mono">{screenId ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Redux code</dt>
                <dd className="font-mono">{code ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">LocalStorage screenId</dt>
                <dd className="font-mono">{lsScreenId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">LocalStorage code</dt>
                <dd className="font-mono">{lsCode}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Linked</dt>
                <dd className="font-mono">{isLinked ? "true" : "false"}</dd>
              </div>
            </dl>
          </div>

          {/* Quick actions */}
          <div className="lg:col-span-8 p-6 rounded-2xl border bg-white shadow-sm">
            <h2 className="text-lg font-semibold">Quick Actions</h2>
            <p className="mt-2 text-sm text-slate-600">
              Use this area while testing registration/link flow.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                className="px-4 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-800"
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
              <button
                className="px-4 py-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-800"
                onClick={() => alert("Navigate to your player route when ready")}
              >
                Open Player (stub)
              </button>
            </div>

            {code && (
              <div className="mt-6">
                <p className="text-slate-600 text-sm">Pairing code</p>
                <div className="mt-2 text-5xl font-bold tracking-widest">
                  {String(code).padStart(6, "0")}
                </div>
              </div>
            )}
          </div>

          {/* Notes (full width row) */}
          <div className="lg:col-span-12 p-6 rounded-2xl border bg-white shadow-sm">
            <h2 className="text-lg font-semibold">Notes</h2>
            <ul className="mt-3 list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li><span className="font-medium">Registered</span> means the device has a screenId.</li>
              <li><span className="font-medium">Linked</span> means a matching <code>.ScreenLinked</code> event was received.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

// src/features/screens/CreateScreen.tsx
import { useEffect, useRef, useState } from "react";
import { useCreateScreen } from "../ReactQuery/CreateScreen/CreateScreen";
import { echo } from "../echo";
import { useNavigate } from "react-router-dom";

/* ──────────────────────────────────────────────────────────────
  Types & Constants
────────────────────────────────────────────────────────────── */
type DeviceState = {
  code?: number | string;
  screenId?: string;
  linked?: boolean;
};

const LS_SCREEN_ID = "screenId";
const LS_LINKED = "linked";
const LS_TOKEN = "authToken";

/* ──────────────────────────────────────────────────────────────
  Small UI atoms (light theme)
────────────────────────────────────────────────────────────── */
function Badge({
  color = "slate",
  children,
}: {
  color?: "slate" | "green" | "red" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    slate: "bg-gray-100 text-gray-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[color]}`}
    >
      {children}
    </span>
  );
}

function Spinner({
  className = "w-5 h-5 text-red-600",
}: {
  className?: string;
}) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function IconCheck({
  className = "w-5 h-5 text-green-600",
}: {
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12a9 9 0 10-3.16 6.86"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 12v7h-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-black hover:bg-gray-50 transition"
    >
      {copied ? (
        <>
          <IconCheck className="w-4 h-4 text-green-600" /> Copied
        </>
      ) : (
        <>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
            <rect
              x="9"
              y="9"
              width="13"
              height="13"
              rx="2"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect
              x="2"
              y="2"
              width="13"
              height="13"
              rx="2"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────
  Main
────────────────────────────────────────────────────────────── */
export default function CreateScreen() {
  const navigate = useNavigate();
  const { mutate, isPending, isError, error, data, reset } = useCreateScreen();

  const [deviceState, setDeviceState] = useState<DeviceState>({});
  const [shouldRegister, setShouldRegister] = useState(false);

  // Guards / refs
  const lockedRef = useRef(false); // prevent duplicate .mutate() calls once we have an ID
  const firedRef = useRef(false); // ensure we only call mutate() once per session
  const linkedRef = useRef(false); // latched "linked" to avoid double redirects
  const unsubRef = useRef<(() => void) | null>(null); // echo unsubscriber
  const expectedIdRef = useRef<string | undefined>(undefined); // the id we expect to be linked

  /* 1) Hydrate state (from localStorage and optional preload API if available) */
  useEffect(() => {
    const lsScreenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
    const lsLinked = localStorage.getItem(LS_LINKED) === "1";

    if (lsScreenId || lsLinked) {
      setDeviceState({ screenId: lsScreenId, linked: lsLinked });
    }

    const api = (window as any)?.signage;
    if (!api?.getDeviceState) {
      const hasExistingId = Boolean(lsScreenId);
      // reserve registration only (prevents re-register), not a "linked" signal
      lockedRef.current = hasExistingId;
      setShouldRegister(!hasExistingId);
      return;
    }

    api
      .getDeviceState()
      .then((s: DeviceState) => {
        const screenId = s?.screenId ?? lsScreenId;
        const linked = s?.linked ?? lsLinked;
        setDeviceState({ screenId, linked });

        const hasExistingId = Boolean(screenId);
        lockedRef.current = hasExistingId; // just blocks duplicate register
        setShouldRegister(!hasExistingId);
      })
      .catch(() => {
        const hasExistingId = Boolean(lsScreenId);
        lockedRef.current = hasExistingId;
        setShouldRegister(!hasExistingId);
      });
  }, []);

  /* 2) Already linked => go Home */
  useEffect(() => {
    const screenId = deviceState?.screenId;
    const linked =
      Boolean(deviceState?.linked) || localStorage.getItem(LS_LINKED) === "1";
    if (screenId && linked && !linkedRef.current) {
      linkedRef.current = true;
      navigate("/");
    }
  }, [deviceState?.linked, deviceState?.screenId, navigate]);

  /* 3) Register once if needed */
  useEffect(() => {
    if (!shouldRegister || firedRef.current || lockedRef.current) return;
    firedRef.current = true;
    mutate();
  }, [shouldRegister, mutate]);

  /* 4) After success: save screenId + pairing code */
  useEffect(() => {
    if (!data?.screenId) return;

    const screenIdStr = String(data.screenId);
    // persist to optional bridge API
    const api = (window as any)?.signage;
    api?.saveScreenId?.(screenIdStr).catch(() => {});

    // persist to localStorage
    localStorage.setItem(LS_SCREEN_ID, screenIdStr);

    setDeviceState((prev) => ({
      ...prev,
      screenId: screenIdStr,
      code: data.code,
    }));

    // block re-register (but not used to label UI)
    lockedRef.current = true;
    firedRef.current = true;
    setShouldRegister(false);
  }, [data?.screenId, data?.code]);

  /* 5) Track expected id for pairing verification */
  useEffect(() => {
    const id =
      (data?.screenId != null ? String(data.screenId) : undefined) ??
      (deviceState?.screenId != null
        ? String(deviceState.screenId)
        : undefined);
    expectedIdRef.current = id;
  }, [data?.screenId, deviceState?.screenId]);

  /* 6) Echo listener (pairing) */
  const pairingCode = (data?.code ?? deviceState?.code) as
    | string
    | number
    | undefined;

  useEffect(() => {
    const lsLinked = localStorage.getItem(LS_LINKED) === "1";
    const alreadyLinked = Boolean(deviceState?.linked) || lsLinked;
    if (!pairingCode || alreadyLinked || linkedRef.current) return;

    const channelName = `code.${pairingCode}`;
    const channel = echo.channel(channelName);

    const handler = (e: {
      screen_id?: number | string;
      next_url?: string;
      screenToken?: string;
      screenName?: string;
    }) => {
      const expected = expectedIdRef.current?.toString();
      const eventId = e?.screen_id?.toString();

      // Accept if ids match, or if backend emits only a token without id
      const accept =
        (expected && eventId === expected) || (!eventId && !!e?.screenToken);

      if (!accept) {
        console.warn("[pairing] ignored: expected", expected, "got", eventId);
        return;
      }

      if (e?.screenToken) {
        localStorage.setItem(LS_TOKEN, String(e.screenToken));
        console.log("[pairing] ✅ Saved screenToken:", e.screenToken);
      }
      if (e?.screenName) {
        localStorage.setItem("screenName", String(e.screenName));
        console.log("[pairing] ✅ Saved screenName:", e.screenName);
      }
      const api = (window as any)?.signage;
      api?.setLinked?.(true).catch(() => {});
      localStorage.setItem(LS_LINKED, "1");
      window.dispatchEvent(new Event("iguana:linked"));
      setTimeout(() => {
  window.location.reload();
}, 20_000);

      setDeviceState((prev) => ({ ...prev, linked: true }));
      linkedRef.current = true;

      channel.stopListening(".ScreenLinked", handler);
      echo.leave(channelName);
      unsubRef.current = null;

      navigate("/");
    };

    channel.listen(".ScreenLinked", handler);
    unsubRef.current = () => {
      channel.stopListening(".ScreenLinked", handler);
      echo.leave(channelName);
    };

    return () => {
      try {
        unsubRef.current?.();
      } catch {}
      unsubRef.current = null;
    };
  }, [pairingCode, deviceState?.linked, navigate]);

  /* 7) Reset flow (also leaves echo channel) */
  const handleReset = () => {
    try {
      unsubRef.current?.();
    } catch {}
    unsubRef.current = null;

    const api = (window as any)?.signage;
    api?.resetDevice?.().catch(() => {});
    localStorage.removeItem(LS_SCREEN_ID);
    localStorage.removeItem(LS_LINKED);
    localStorage.removeItem(LS_TOKEN);
    setDeviceState({});
    lockedRef.current = false;
    firedRef.current = false;
    linkedRef.current = false;
    setShouldRegister(true);
  };

  /* ──────────────────────────────────────────────────────────────
    Derived UI State (fixed)
  ────────────────────────────────────────────────────────────── */
  const lsScreenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
  const lsLinked = localStorage.getItem(LS_LINKED) === "1";

  const hasId = Boolean(deviceState?.screenId || lsScreenId);
  const isLinked =
    Boolean(deviceState?.linked) || lsLinked || linkedRef.current;

  const showPairingUI = hasId && !isLinked;
  const flowText = isLinked
    ? "Device is linked"
    : hasId
    ? "Awaiting linking (enter the pairing code in admin)"
    : shouldRegister
    ? isPending
      ? "Registering…"
      : "Preparing registration…"
    : "Waiting…";

  /* ──────────────────────────────────────────────────────────────
    UI (Light Theme — white bg, black text, red accents)
  ────────────────────────────────────────────────────────────── */
  // if already linked + has id, nothing to show (may navigate right away)
  if (hasId && isLinked) return null;

  return (
    <div className="min-h-dvh bg-white text-black flex flex-col">
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-red-100 grid place-items-center shrink-0">
              <svg
                className="w-6 h-6 text-red-600"
                viewBox="0 0 24 24"
                fill="none"
              >
                <rect
                  x="3"
                  y="4"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 20h8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold">
                Register Screen
              </h1>
              <p className="text-gray-600 text-sm sm:text-base">
                Link this device to your signage account
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {isPending && <Badge color="amber">Contacting server…</Badge>}
            {isError && <Badge color="red">Registration failed</Badge>}
            {!isPending && !isError && !hasId && (
              <Badge color="blue">Awaiting registration</Badge>
            )}
            {hasId && !isLinked && <Badge color="blue">ID reserved</Badge>}
            {isLinked && <Badge color="green">Linked</Badge>}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Status Card */}
          <div className="lg:col-span-3 border border-gray-200 bg-white rounded-2xl p-5 sm:p-6 shadow">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg sm:text-xl font-semibold">Status</h2>
              {isPending && <Spinner className="w-5 h-5 text-red-600" />}
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:text-base">
              {/* Device ID */}
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-gray-600">Device ID</span>
                <span className="font-mono break-all">
                  {lsScreenId || deviceState?.screenId || (
                    <span className="text-gray-400">—</span>
                  )}
                </span>
              </div>

              {/* Linked */}
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-gray-600">Linked</span>
                <span className="font-medium">
                  {isLinked ? (
                    <span className="inline-flex items-center gap-2 text-green-600">
                      <IconCheck /> Linked
                    </span>
                  ) : (
                    <span className="text-gray-500">Not yet</span>
                  )}
                </span>
              </div>

              {/* Flow */}
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-gray-600">Flow</span>
                <span className="text-black/90 truncate">{flowText}</span>
              </div>
            </div>

            {/* Error block */}
            {showPairingUI && isError && (
              <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm sm:text-base">
                <p className="font-semibold text-red-700">Failed to register</p>
                <p className="text-red-600 mt-1">
                  {(error as any)?.message ?? "Unknown error"}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      if (lockedRef.current) return;
                      reset();
                      firedRef.current = false;
                      mutate();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 text-white px-4 py-2 font-medium hover:bg-red-700 transition disabled:opacity-50"
                    disabled={lockedRef.current}
                  >
                    <IconRefresh className="text-white" />
                    Try again
                  </button>
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-100 transition"
                  >
                    Clear pairing
                  </button>
                </div>
              </div>
            )}

            {showPairingUI && !isError && isPending && (
              <p className="mt-6 text-gray-600 text-sm sm:text-base">
                Contacting server…
              </p>
            )}
          </div>

          {/* Pairing Card */}
          <div className="lg:col-span-2 border border-gray-200 bg-white rounded-2xl p-5 sm:p-6 shadow">
            <h2 className="text-lg sm:text-xl font-semibold">Pairing</h2>

            {showPairingUI && pairingCode != null ? (
              <>
                <p className="mt-2 text-gray-600 text-sm sm:text-base">
                  Your pairing code
                </p>
                <div className="mt-3 flex items-end gap-3 justify-center">
                  <div className="text-5xl sm:text-6xl font-bold tracking-[.25em] text-center text-red-600 select-all break-words">
                    {String(pairingCode).padStart(6, "0")}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <CopyButton text={String(pairingCode).padStart(6, "0")} />
                  <button
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 transition"
                  >
                    <IconRefresh /> Refresh
                  </button>
                </div>

                <hr className="my-6 border-gray-200" />
                <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
                  <p>• افتح لوحة التحكم وأدخل الكود لربط الشاشة.</p>
                  <p>
                    • عند نجاح الربط، سيتم الانتقال تلقائيًا للصفحة الرئيسية.
                  </p>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-gray-600 text-sm sm:text-base">
                  Waiting for pairing code…
                </p>
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Spinner className="w-4 h-4 text-red-600" />
                  <span>
                    If this takes long, click “Clear pairing” and try again.
                  </span>
                </div>
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={handleReset}
                className="w-full rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 transition text-sm sm:text-base"
              >
                Clear Pairing (ID & Code)
              </button>
            </div>
          </div>
        </div>

        {/* Steps / Help */}
        <div className="mt-10 border border-gray-200 bg-white rounded-2xl p-5 sm:p-6 shadow text-gray-800">
          <h3 className="font-semibold text-lg sm:text-xl">How this works</h3>
          <ol className="mt-3 grid gap-3 sm:gap-4 text-sm sm:text-base md:grid-cols-3 text-gray-700">
            <li className="rounded-lg bg-gray-50 p-3 sm:p-4">
              1) We request a new Screen ID from the server.
            </li>
            <li className="rounded-lg bg-gray-50 p-3 sm:p-4">
              2) Enter the pairing code in your admin panel to link this device.
            </li>
            <li className="rounded-lg bg-gray-50 p-3 sm:p-4">
              3) When linked, the device saves the token and redirects to the
              player.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

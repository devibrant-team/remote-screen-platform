// src/features/screens/CreateScreen.tsx
import { useEffect, useRef, useState } from "react";
import { useCreateScreen } from "../../ReactQuery/CreateScreen/CreateScreen";
import { echo } from "../../echo";
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
  Small UI atoms
────────────────────────────────────────────────────────────── */
function Badge({
  color = "slate",
  children,
}: {
  color?: "slate" | "green" | "red" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
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

function Spinner({ className = "w-5 h-5" }: { className?: string }) {
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

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
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
      className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 transition"
    >
      {copied ? (
        <>
          <IconCheck className="w-4 h-4" /> Copied
        </>
      ) : (
        <>
          {/* copy icon */}
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

  // Guards
  const lockedRef = useRef(false);
  const firedRef = useRef(false);
  const linkedRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const channelRef = useRef<ReturnType<typeof echo.channel> | null>(null);
  const expectedIdRef = useRef<string | undefined>(undefined);

  /* 1) Hydrate state */
  useEffect(() => {
    const lsScreenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
    const lsLinked = localStorage.getItem(LS_LINKED) === "1";

    if (lsScreenId || lsLinked) {
      setDeviceState({ screenId: lsScreenId, linked: lsLinked });
    }

    const api = (window as any)?.signage;
    if (!api?.getDeviceState) {
      const hasExisting = Boolean(lsScreenId);
      lockedRef.current = hasExisting;
      setShouldRegister(!hasExisting);
      return;
    }

    api
      .getDeviceState()
      .then((s: DeviceState) => {
        setDeviceState({
          screenId: s?.screenId ?? lsScreenId,
          linked: s?.linked ?? lsLinked,
        });
        const hasExisting = Boolean(lsScreenId || s?.screenId);
        lockedRef.current = hasExisting;
        setShouldRegister(!hasExisting);
      })
      .catch(() => {
        const hasExisting = Boolean(lsScreenId);
        lockedRef.current = hasExisting;
        setShouldRegister(!hasExisting);
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

  /* 4) After success */
  useEffect(() => {
    if (!data?.screenId || lockedRef.current) return;

    const api = (window as any)?.signage;
    api?.saveScreenId?.(String(data.screenId)).catch(() => {});

    localStorage.setItem(LS_SCREEN_ID, String(data.screenId));
    setDeviceState({ screenId: String(data.screenId), code: data.code });

    lockedRef.current = true;
    firedRef.current = true;
    setShouldRegister(false);
  }, [data?.screenId, data?.code]);

  /* Track expected id */
  useEffect(() => {
    const id =
      (data?.screenId != null ? String(data.screenId) : undefined) ??
      (deviceState?.screenId != null
        ? String(deviceState.screenId)
        : undefined);
    expectedIdRef.current = id;
  }, [data?.screenId, deviceState?.screenId]);

  /* 5) Echo listener */
  const pairingCode = (data?.code ?? deviceState?.code) as
    | string
    | number
    | undefined;

  useEffect(() => {
    const alreadyLinked =
      Boolean(deviceState?.linked) || localStorage.getItem(LS_LINKED) === "1";
    if (!pairingCode || alreadyLinked || linkedRef.current) return;

    const channelName = `code.${pairingCode}`;
    const channel = echo.channel(channelName);
    channelRef.current = channel;

    const handler = (e: {
      screen_id: number | string;
      next_url?: string;
      screenToken?: string;
    }) => {
      const expected = expectedIdRef.current?.toString();
      const eventId = e?.screen_id?.toString();

      if (expected && eventId === expected) {
        if (e?.screenToken) {
          localStorage.setItem(LS_TOKEN, String(e.screenToken));
          console.log("[pairing] ✅ Saved screenToken:", e.screenToken);
        }

        const api = (window as any)?.signage;
        api?.setLinked?.(true).catch(() => {});
        localStorage.setItem(LS_LINKED, "1");
        setDeviceState((prev) => ({ ...prev, linked: true }));
        linkedRef.current = true;

        channel.stopListening(".ScreenLinked", handler);
        echo.leave(channelName);
        unsubRef.current = null;

        navigate("/");
      } else {
        console.warn("[pairing] ignored: expected", expected, "got", eventId);
      }
    };

    channel.listen(".ScreenLinked", handler);
    unsubRef.current = () => {
      channel.stopListening(".ScreenLinked", handler);
      echo.leave(channelName);
    };

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      channelRef.current = null;
    };
  }, [pairingCode, deviceState?.linked, navigate]);

  /* 6) Reset flow */
  const handleReset = () => {
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
    Derived UI State
  ────────────────────────────────────────────────────────────── */
  const showPairingUI =
    !linkedRef.current &&
    !(
      (deviceState?.linked || localStorage.getItem(LS_LINKED) === "1") &&
      deviceState?.screenId
    );

  const hasId = Boolean(deviceState?.screenId);
  const isLinked =
    Boolean(deviceState?.linked) ||
    localStorage.getItem(LS_LINKED) === "1" ||
    linkedRef.current;

  if (hasId && isLinked) return null;

/* ──────────────────────────────────────────────────────────────
  UI (Responsive Enhanced)
────────────────────────────────────────────────────────────── */
return (
  <div className="min-h-dvh relative overflow-hidden flex flex-col">
    {/* background */}
    <div className="absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-black" />
      <div className="absolute -top-24 -left-24 h-72 w-72 md:h-96 md:w-96 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-72 w-72 md:h-96 md:w-96 rounded-full bg-cyan-500/20 blur-3xl" />
    </div>

    {/* container */}
    <div className="flex-1 w-full mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      {/* header */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-white/10 grid place-items-center shrink-0">
            <svg
              className="w-6 h-6 text-white"
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
            <h1 className="text-2xl sm:text-3xl font-semibold text-white">
              Register Screen
            </h1>
            <p className="text-white/60 text-sm sm:text-base">
              Link this device to your signage account
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {isPending && <Badge color="amber">Contacting server…</Badge>}
          {isError && <Badge color="red">Registration failed</Badge>}
          {!isPending && !isError && !lockedRef.current && (
            <Badge color="blue">Awaiting registration</Badge>
          )}
          {lockedRef.current && <Badge color="green">ID reserved</Badge>}
        </div>
      </div>

      {/* grid - responsive */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Main card */}
        <div className="lg:col-span-3 order-2 lg:order-1">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5 sm:p-6 text-white shadow-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg sm:text-xl font-semibold">Status</h2>
              {isPending && <Spinner className="w-5 h-5 text-white/80" />}
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:text-base">
              {/* Device ID */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-white/70">Device ID</span>
                <span className="font-mono break-all">
                  {localStorage.getItem(LS_SCREEN_ID) || (
                    <span className="opacity-60">—</span>
                  )}
                </span>
              </div>

              {/* Linked */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-white/70">Linked</span>
                <span className="font-medium">
                  {deviceState?.linked ||
                  localStorage.getItem(LS_LINKED) === "1" ? (
                    <span className="inline-flex items-center gap-2 text-green-400">
                      <IconCheck className="w-5 h-5" /> Linked
                    </span>
                  ) : (
                    <span className="text-white/60">Not yet</span>
                  )}
                </span>
              </div>

              {/* Flow */}
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 sm:px-4 py-2.5 sm:py-3">
                <span className="text-white/70">Flow</span>
                <span className="text-white/90 truncate">
                  {lockedRef.current
                    ? "Screen already registered"
                    : "Registering…"}
                </span>
              </div>
            </div>

            {/* Error block */}
            {showPairingUI &&
              !lockedRef.current &&
              shouldRegister &&
              isError && (
                <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm sm:text-base">
                  <p className="font-semibold text-red-200">
                    Failed to register
                  </p>
                  <p className="text-red-200/80 mt-1">
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
                      className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-4 py-2 font-medium hover:bg-white/90 transition disabled:opacity-50"
                      disabled={lockedRef.current}
                    >
                      <IconRefresh />
                      Try again
                    </button>
                    <button
                      onClick={handleReset}
                      className="inline-flex items-center rounded-lg border border-white/20 px-4 py-2 hover:bg-white/10 transition"
                    >
                      Clear pairing
                    </button>
                  </div>
                </div>
              )}

            {showPairingUI &&
              !lockedRef.current &&
              shouldRegister &&
              isPending && (
                <p className="mt-6 text-white/70 text-sm sm:text-base">
                  Contacting server…
                </p>
              )}
          </div>
        </div>

        {/* Pairing card */}
        <div className="lg:col-span-2 order-1 lg:order-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5 sm:p-6 text-white shadow-lg">
            <h2 className="text-lg sm:text-xl font-semibold">Pairing</h2>

            {showPairingUI && pairingCode != null ? (
              <>
                <p className="mt-2 text-white/60 text-sm sm:text-base">
                  Your pairing code
                </p>
                <div className="mt-3 flex items-end gap-3 justify-center">
                  <div className="text-5xl sm:text-6xl font-bold tracking-[.25em] text-center select-all break-words">
                    {String(pairingCode).padStart(6, "0")}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <CopyButton text={String(pairingCode).padStart(6, "0")} />
                  <button
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 transition"
                  >
                    <IconRefresh /> Refresh
                  </button>
                </div>

                <hr className="my-6 border-white/10" />
                <div className="space-y-2 text-sm text-white/70 leading-relaxed">
                  <p>• افتح لوحة التحكم وأدخل الكود لربط الشاشة.</p>
                  <p>• عند نجاح الربط، سيتم الانتقال تلقائيًا للصفحة الرئيسية.</p>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-white/70 text-sm sm:text-base">
                  Waiting for pairing code…
                </p>
                <div className="flex items-center gap-2 text-white/60 text-sm">
                  <Spinner className="w-4 h-4" />
                  <span>
                    If this takes long, click “Clear pairing” and try again.
                  </span>
                </div>
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={handleReset}
                className="w-full rounded-lg bg-red-500 px-4 py-2.5 font-medium text-white hover:bg-red-600 transition text-sm sm:text-base"
              >
                Clear Pairing (ID & Code)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Steps / Help */}
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 text-white">
        <h3 className="font-semibold text-lg sm:text-xl">How this works</h3>
        <ol className="mt-3 grid gap-3 sm:gap-4 text-white/80 text-sm sm:text-base md:grid-cols-3">
          <li className="rounded-lg bg-white/5 p-3 sm:p-4">
            1) We request a new Screen ID from the server.
          </li>
          <li className="rounded-lg bg-white/5 p-3 sm:p-4">
            2) Enter the pairing code in your admin panel to link this device.
          </li>
          <li className="rounded-lg bg-white/5 p-3 sm:p-4">
            3) When linked, the device saves the token and redirects to the
            player.
          </li>
        </ol>
      </div>
    </div>
  </div>
);

}

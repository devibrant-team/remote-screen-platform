// src/features/screens/CreateScreen.tsx
import { useEffect, useRef, useState } from "react";
import { useCreateScreen } from "../../ReactQuery/CreateScreen/CreateScreen";
import { echo } from "../../echo";
import { useNavigate } from "react-router-dom";

type DeviceState = {
  code?: number | string;
  screenId?: string;
  linked?: boolean;
};

const LS_SCREEN_ID = "screenId";
const LS_CODE = "code";
const LS_LINKED = "linked";

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

  // ===== 1) Hydrate state =====
  useEffect(() => {
    const lsScreenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
    const lsCode = localStorage.getItem(LS_CODE) || undefined;
    const lsLinked = localStorage.getItem(LS_LINKED) === "1";

    if (lsScreenId || lsCode || lsLinked) {
      setDeviceState({
        screenId: lsScreenId,
        code: lsCode,
        linked: lsLinked,
      });
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
          code: s?.code ?? lsCode,
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

  // ===== 2) Already linked => go Home =====
  useEffect(() => {
    const screenId = deviceState?.screenId;
    const linked =
      Boolean(deviceState?.linked) || localStorage.getItem(LS_LINKED) === "1";
    if (screenId && linked && !linkedRef.current) {
      linkedRef.current = true;
      navigate("/");
    }
  }, [deviceState?.linked, deviceState?.screenId, navigate]);

  // ===== 3) Register once if needed =====
  useEffect(() => {
    if (!shouldRegister || firedRef.current || lockedRef.current) return;
    firedRef.current = true;
    mutate();
  }, [shouldRegister, mutate]);

  // ===== 4) After success =====
  useEffect(() => {
    if (!data?.screenId || lockedRef.current) return;

    const api = (window as any)?.signage;
    api?.saveScreenId?.(String(data.screenId)).catch(() => {});

    localStorage.setItem(LS_SCREEN_ID, String(data.screenId));
    if (data.code != null) localStorage.setItem(LS_CODE, String(data.code));

    setDeviceState({
      screenId: String(data.screenId),
      code: data.code,
    });

    lockedRef.current = true;
    firedRef.current = true;
    setShouldRegister(false);
  }, [data?.screenId, data?.code]);

  // Track expected id
  useEffect(() => {
    const id =
      (data?.screenId != null ? String(data.screenId) : undefined) ??
      (deviceState?.screenId != null
        ? String(deviceState.screenId)
        : undefined);
    expectedIdRef.current = id;
  }, [data?.screenId, deviceState?.screenId]);

  // ===== 5) Echo listener =====
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

    const handler = (e: { screen_id: number | string }) => {
      const expected = expectedIdRef.current?.toString();
      const eventId = e?.screen_id?.toString();

      if (expected && eventId === expected) {
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

  // ===== 6) Reset flow =====
  const handleReset = () => {
    const api = (window as any)?.signage;
    api?.resetDevice?.().catch(() => {});
    localStorage.removeItem(LS_SCREEN_ID);
    localStorage.removeItem(LS_CODE);
    localStorage.removeItem(LS_LINKED);
    setDeviceState({});
    lockedRef.current = false;
    firedRef.current = false;
    linkedRef.current = false;
    setShouldRegister(true);
  };

  // ===== UI =====
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

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="rounded-2xl shadow p-8 text-center max-w-md w-full">
        <h1 className="text-2xl font-semibold">
          {lockedRef.current
            ? "Screen Already Registered"
            : "Registering Screen…"}
        </h1>

        {showPairingUI && !lockedRef.current && shouldRegister && isPending && (
          <p className="mt-2 opacity-70">Contacting server…</p>
        )}

        {showPairingUI && !lockedRef.current && shouldRegister && isError && (
          <div className="mt-4 space-y-3">
            <div className="text-red-600">
              <p className="font-medium">Failed to register.</p>
              <p className="text-sm opacity-80">
                {(error as any)?.message ?? "Unknown error"}
              </p>
            </div>
            <button
              onClick={() => {
                if (lockedRef.current) return;
                reset();
                firedRef.current = false;
                mutate();
              }}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 border hover:bg-slate-50"
              disabled={lockedRef.current}
            >
              Try again
            </button>
          </div>
        )}

        {showPairingUI && pairingCode != null && (
          <>
            <p className="mt-6 text-slate-600">Your pairing code</p>
            <div className="mt-2 text-6xl font-bold tracking-widest">
              {String(pairingCode).padStart(6, "0")}
            </div>
          </>
        )}
      </div>

      <button
        onClick={handleReset}
        className="mt-6 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
      >
        Clear Pairing (ID & Code)
      </button>
    </div>
  );
}

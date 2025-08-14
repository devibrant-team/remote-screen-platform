// src/features/screens/CreateScreen.tsx
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../../../store";
import { useCreateScreen } from "../../ReactQuery/CreateScreen/CreateScreen";
import { setScreenId, setCode } from "../../Redux/appSlice";
import { echo } from "../../echo";

type DeviceState = { code?: number | string; screenId?: string };

const LS_SCREEN_ID = "screenId";
const LS_CODE = "code";

export default function CreateScreen() {
  const dispatch = useDispatch();
  const reduxScreenId = useSelector((s: RootState) => s.app.screenId);
  const reduxCode = useSelector((s: RootState) => s.app.code);

  const { mutate, isPending, isError, error, data, reset } = useCreateScreen();

  const [deviceState, setDeviceState] = useState<DeviceState>({});
  const [shouldRegister, setShouldRegister] = useState(false);
  const lockedRef = useRef(false); // once we have an ID, lock all writes

  // 1) Initial load: read localStorage and Electron store, decide if we should register
  useEffect(() => {
    // localStorage first
    const lsScreenId = localStorage.getItem(LS_SCREEN_ID) || undefined;
    const lsCode = localStorage.getItem(LS_CODE) || undefined;
    if (lsScreenId || lsCode) {
      setDeviceState((prev) => ({
        ...prev,
        screenId: lsScreenId ?? prev.screenId,
        code: lsCode ?? prev.code,
      }));
      if (!reduxScreenId && lsScreenId) dispatch(setScreenId(lsScreenId));
      if (reduxCode == null && lsCode != null) dispatch(setCode(lsCode));
    }

    // electron store (authoritative)
    const api = (window as any)?.signage;
    if (!api?.getDeviceState) {
      const hasExisting = Boolean(reduxScreenId || lsScreenId);
      lockedRef.current = hasExisting;
      setShouldRegister(!hasExisting);
      return;
    }

    api
      .getDeviceState()
      .then((s: DeviceState) => {
        setDeviceState((prev) => ({
          ...prev,
          screenId: s?.screenId ?? prev.screenId,
          code: s?.code ?? prev.code,
        }));
        if (!reduxScreenId && s?.screenId) dispatch(setScreenId(String(s.screenId)));
        if (reduxCode == null && s?.code != null) dispatch(setCode(s.code));

        const hasExisting = Boolean(reduxScreenId || lsScreenId || s?.screenId);
        lockedRef.current = hasExisting;
        setShouldRegister(!hasExisting);
      })
      .catch(() => {
        const hasExisting = Boolean(reduxScreenId || lsScreenId);
        lockedRef.current = hasExisting;
        setShouldRegister(!hasExisting);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Fire registration exactly once if needed (and not locked)
  const fired = useRef(false);
  useEffect(() => {
    if (!shouldRegister || fired.current || lockedRef.current) return;
    fired.current = true;
    mutate();
  }, [shouldRegister, mutate]);

  // 3) After success: persist everywhere, then LOCK so it never changes again
  useEffect(() => {
    if (!data?.screenId || lockedRef.current) return;

    // Persist to Electron store
    const api = (window as any)?.signage;
    if (api?.saveScreenId) {
      api.saveScreenId(String(data.screenId)).catch(() => {});
    }

    // Persist to Redux
    dispatch(setScreenId(data.screenId));
    if (data.code != null) dispatch(setCode(data.code));

    // Persist to localStorage
    localStorage.setItem(LS_SCREEN_ID, String(data.screenId));
    if (data.code != null) localStorage.setItem(LS_CODE, String(data.code));

    // Reflect in local UI
    setDeviceState((prev) => ({
      ...prev,
      screenId: String(data.screenId),
      code: data.code ?? prev.code,
    }));

    // 🔒 lock further changes + prevent any retry flow
    lockedRef.current = true;
    fired.current = true;
    setShouldRegister(false);
  }, [data?.screenId, data?.code, dispatch]);

  // 4) Echo listener — subscribe once when we have a pairing code
  const pairingCode = data?.code ?? deviceState?.code;
  const echoSubRef = useRef(false);
  echo.channel(`code.${pairingCode}`).listen(".ScreenLinked", (e: any) => {
    console.log("✅ Screen is connected!", e);
    // e.screen_id and e.next_url come from broadcastWith()
  });


  // 5) Optional: reset button (kept for manual clearing, otherwise API will never fire again)
  const handleReset = () => {
    // Redux
    dispatch(setScreenId(undefined));
    dispatch(setCode(undefined));
    // Electron store
    const api = (window as any)?.signage;
    api?.resetDevice?.().catch(() => {});
    // localStorage
    localStorage.removeItem(LS_SCREEN_ID);
    localStorage.removeItem(LS_CODE);
    // Local UI + flags (allow re-register)
    setDeviceState({});
    lockedRef.current = false;
    fired.current = false;
    setShouldRegister(true);
  };

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="rounded-2xl shadow p-8 text-center max-w-md w-full">
        <h1 className="text-2xl font-semibold">
          {lockedRef.current ? "Screen Already Registered" : "Registering Screen…"}
        </h1>

        {!lockedRef.current && shouldRegister && isPending && (
          <p className="mt-2 opacity-70">Contacting server…</p>
        )}

        {!lockedRef.current && shouldRegister && isError && (
          <div className="mt-4 space-y-3">
            <div className="text-red-600">
              <p className="font-medium">Failed to register.</p>
              <p className="text-sm opacity-80">
                {(error as any)?.message ?? "Unknown error"}
              </p>
            </div>
            <button
              onClick={() => {
                if (lockedRef.current) return; // safeguard
                reset();
                fired.current = false;
                mutate();
              }}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 border hover:bg-slate-50"
              disabled={lockedRef.current}
            >
              Try again
            </button>
          </div>
        )}

        {(pairingCode != null || deviceState?.screenId || reduxScreenId) && (
          <>
            {pairingCode != null && (
              <>
                <p className="mt-6 text-slate-600">Your pairing code</p>
                <div className="mt-2 text-6xl font-bold tracking-widest">
                  {String(pairingCode).padStart(6, "0")}
                </div>
              </>
            )}

            <div className="mt-6 text-left text-sm text-slate-700 space-y-1">
              <div>
                <span className="font-medium">Redux screenId:</span>{" "}
                <span className="font-mono">{reduxScreenId ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Redux code:</span>{" "}
                <span className="font-mono">{reduxCode ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Device (Electron) screenId:</span>{" "}
                <span className="font-mono">{deviceState?.screenId ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Device (Electron) code:</span>{" "}
                <span className="font-mono">{deviceState?.code ?? "—"}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Keep reset button for manual clear; otherwise API will never run again */}
      <button
        onClick={handleReset}
        className="mt-6 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
      >
        Clear Screen ID & Code
      </button>
    </div>
  );
}

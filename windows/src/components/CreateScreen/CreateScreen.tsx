// src/features/screens/CreateScreen.tsx
import { useEffect, useRef } from "react";
import { useCreateScreen } from "../../ReactQuery/CreateScreen/CreateScreen";

export default function CreateScreen() {
  const { mutate, isPending, isError, error, data, reset } = useCreateScreen();

  // Fire exactly once (guard against StrictMode double-invoke)
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    mutate(); // no args; POST with empty body
  }, [mutate]);

  // Fallback: if the preload didn't save for any reason, save here once.
  const savedOnce = useRef(false);
  useEffect(() => {
    if (!data?.screenId || savedOnce.current) return;
    const api = (window as any)?.signage;
    if (api?.saveScreenId) {
      savedOnce.current = true;
      api.saveScreenId(String(data.screenId)).catch(() => {
        // ignore; UI still shows code and the user can retry
      });
    }
  }, [data?.screenId]);

  return (
    <div className="min-h-dvh grid place-items-center p-6">
      <div className="rounded-2xl shadow p-8 text-center max-w-md w-full">
        <h1 className="text-2xl font-semibold">Registering Screen…</h1>

        {isPending && <p className="mt-2 opacity-70">Contacting server…</p>}

        {isError && (
          <div className="mt-4 space-y-3">
            <div className="text-red-600">
              <p className="font-medium">Failed to register.</p>
              <p className="text-sm opacity-80">
                {(error as any)?.message ?? "Unknown error"}
              </p>
            </div>
            <button
              onClick={() => {
                savedOnce.current = false;
                reset();
                mutate();
              }}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 border hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        )}

        {data?.code != null && (
          <>
            <p className="mt-6 text-slate-600">Your pairing code</p>
            <div className="mt-2 text-6xl font-bold tracking-widest">
              {String(data.code).padStart(6, "0")}
            </div>

            <div className="mt-5 text-sm text-slate-600">
              <div>Screen ID: <span className="font-mono">{data.screenId}</span></div>
              <div className="opacity-70">Saved to device storage.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  checkServerReachable,
  clearServerIp,
  connectWithRetry,
  getServerIp,
  normalizeServerIp,
  saveServerIp,
} from "./config/serverConfig";

import "./index.css";

const AppShell = lazy(() => import("./AppShell"));
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 15000;
const SAVED_ADDRESS_ERROR =
  "Could not connect to the server. The address may have changed. Please enter the new server address.";
const MANUAL_CONNECT_ERROR =
  "Could not connect to the server. Please check the address and try again.";

type AppState = "needs-config" | "checking-saved" | "checking-manual" | "ready";

function LoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-200 border-t-red-600" />
    </div>
  );
}

type ServerConnectScreenProps = {
  state: AppState;
  error: string;
  attemptText: string;
  countdown: number;
  onConnect: (serverAddress: string) => void;
};

function ServerConnectScreen({
  state,
  error,
  attemptText,
  countdown,
  onConnect,
}: ServerConnectScreenProps) {
  const [serverAddress, setServerAddress] = useState("");
  const isChecking = state === "checking-manual" || state === "checking-saved";
  const showRetryStatus = state === "checking-saved";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = normalizeServerIp(serverAddress);
    if (!clean || isChecking) return;
    onConnect(clean);
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-white px-5 py-8 text-zinc-950">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-zinc-100 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)] sm:p-8"
      >
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-600">
            Windows Screen Iguana
          </p>
          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
            Connect to Server
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Enter the server address for this display. The screen will open
            once the connection is ready.
          </p>
        </div>

        <label
          className="text-sm font-medium text-zinc-700"
          htmlFor="serverAddress"
        >
          Server Address
        </label>
        <input
          id="serverAddress"
          autoFocus
          disabled={isChecking}
          value={serverAddress}
          onChange={(event) => setServerAddress(event.target.value)}
          placeholder="Server Address"
          className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500"
        />

        <button
          type="submit"
          disabled={isChecking || !serverAddress.trim()}
          className="mt-5 w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white shadow-lg shadow-red-100 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200"
        >
          {isChecking ? "Connecting..." : "Connect"}
        </button>

        <div className="mt-4 min-h-14 text-sm">
          {showRetryStatus && attemptText && (
            <p className="font-medium text-zinc-700">{attemptText}</p>
          )}
          {showRetryStatus && countdown > 0 && (
            <p className="mt-1 text-zinc-500">
              Retrying in {countdown} seconds
            </p>
          )}
          {error && <p className="text-red-600">{error}</p>}
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const savedServerAddress = getServerIp();
  const [appState, setAppState] = useState<AppState>(() =>
    savedServerAddress ? "checking-saved" : "needs-config"
  );
  const [error, setError] = useState("");
  const [attemptText, setAttemptText] = useState("");
  const [countdown, setCountdown] = useState(0);

  const resetStatus = () => {
    setError("");
    setAttemptText("");
    setCountdown(0);
  };

  const connectSavedAddress = async (serverAddress: string) => {
    setAppState("checking-saved");
    resetStatus();

    try {
      await connectWithRetry(serverAddress, {
        maxAttempts: MAX_ATTEMPTS,
        delayMs: RETRY_DELAY_MS,
        onAttempt: (attempt, maxAttempts) => {
          setAttemptText(`Attempt ${attempt} of ${maxAttempts}`);
          setCountdown(0);
        },
        onCountdown: setCountdown,
      });
      setAppState("ready");
    } catch {
      clearServerIp();
      setError(SAVED_ADDRESS_ERROR);
      setAppState("needs-config");
    }
  };

  const connectManualAddress = async (serverAddress: string) => {
    setAppState("checking-manual");
    resetStatus();

    try {
      const reachable = await checkServerReachable(serverAddress);
      if (!reachable) throw new Error("Server unreachable");

      saveServerIp(serverAddress);
      setAppState("ready");
    } catch {
      clearServerIp();
      setError(MANUAL_CONNECT_ERROR);
      setAppState("needs-config");
    }
  };

  useEffect(() => {
    if (!savedServerAddress) return;
    void connectSavedAddress(savedServerAddress);
  }, []);

  if (appState === "ready") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AppShell />
      </Suspense>
    );
  }

  return (
    <ServerConnectScreen
      state={appState}
      error={error}
      attemptText={attemptText}
      countdown={countdown}
      onConnect={(serverAddress) => void connectManualAddress(serverAddress)}
    />
  );
}

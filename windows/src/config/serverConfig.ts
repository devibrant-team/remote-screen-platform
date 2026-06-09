const KEY = "serverIp";
const API_PORT = 8000;
const REVERB_PORT = 8080;
const REVERB_APP_KEY = "o4ywhiewiedmeup8avwi";

export function normalizeServerIp(serverIp: string) {
  return serverIp
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .trim();
}

export function getServerIp() {
  return localStorage.getItem(KEY) || "";
}

export function saveServerIp(serverIp: string) {
  localStorage.setItem(KEY, normalizeServerIp(serverIp));
}

export function clearServerIp() {
  localStorage.removeItem(KEY);
}

export function hasServerIp() {
  return !!getServerIp();
}

export function buildApiBase(serverIp: string) {
  return `http://${normalizeServerIp(serverIp)}:${API_PORT}/api/`;
}

export function apiBase() {
  return buildApiBase(getServerIp());
}

export async function checkServerReachable(serverIp: string): Promise<boolean> {
  return window.iguana?.pingServer
    ? window.iguana.pingServer(normalizeServerIp(serverIp))
    : false;
}

type RetryOptions = {
  maxAttempts: number;
  delayMs: number;
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  onCountdown?: (secondsLeft: number) => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connectWithRetry(
  serverIp: string,
  { maxAttempts, delayMs, onAttempt, onCountdown }: RetryOptions
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt?.(attempt, maxAttempts);

    const reachable = await checkServerReachable(serverIp);
    if (reachable) {
      return;
    }

    if (attempt === maxAttempts) throw new Error("Server unreachable");

    const seconds = Math.ceil(delayMs / 1000);
    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      onCountdown?.(remaining);
      await wait(1000);
    }
    onCountdown?.(0);
  }
}

export function reverbConfig() {
  return {
    key: REVERB_APP_KEY,
    host: getServerIp(),
    port: REVERB_PORT,
    scheme: "http",
  };
}

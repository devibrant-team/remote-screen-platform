const KEY = "serverIp";
function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function envPort(value: string | undefined, fallback: number) {
  const port = Number(value);
  return validPort(port) ? port : fallback;
}

const API_PORT = envPort(import.meta.env.VITE_API_PORT, 8000);
const REVERB_PORT = envPort(import.meta.env.VITE_REVERB_PORT, 8080);
const REVERB_SCHEME = import.meta.env.VITE_REVERB_SCHEME === "https" ? "https" : "http";
const REVERB_APP_KEY = import.meta.env.VITE_REVERB_APP_KEY || "o4ywhiewiedmeup8avwi";
let activeProxyConfiguration = "";

function configuredHost(value: string) {
  const input = value.trim();
  if (!input) return "";
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("Enter a server host without a path or credentials");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Enter a valid server host");
  }
  if (url.port && !validPort(Number(url.port))) throw new Error("Enter a valid server port");
  return hostname;
}

function addressPort(value: string, fallback: number) {
  const input = value.trim();
  if (!input) return fallback;
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  return url.port ? Number(url.port) : fallback;
}

function configureMediaProxy(host: string, port: number) {
  if (!host || !window.serverConfig?.configureMediaProxy) return;
  const key = `${host}:${port}`;
  if (key === activeProxyConfiguration) return;
  void window.serverConfig.configureMediaProxy(host, port).then((result) => {
    if (result?.ok === true) activeProxyConfiguration = key;
    else console.error("Could not confirm the local media proxy configuration");
  }).catch(() => {
    console.error("Could not configure the local media proxy for the selected server");
  });
}

export function normalizeServerIp(serverIp: string) {
  const host = configuredHost(serverIp);
  const port = addressPort(serverIp, API_PORT);
  if (!validPort(port)) throw new Error("Enter a valid server port");
  return port === API_PORT ? host : `${host}:${port}`;
}

export function getServerIp() {
  const configured = localStorage.getItem(KEY) || "";
  try {
    const host = configuredHost(configured);
    const port = addressPort(configured, API_PORT);
    if (validPort(port)) configureMediaProxy(host, port);
    return port === API_PORT ? host : `${host}:${port}`;
  } catch {
    console.error("Saved server configuration is invalid; reconnect to the server");
    return "";
  }
}

export function saveServerIp(serverIp: string) {
  const host = configuredHost(serverIp);
  const port = addressPort(serverIp, API_PORT);
  if (!validPort(port)) throw new Error("Enter a valid server port");
  localStorage.setItem(KEY, port === API_PORT ? host : `${host}:${port}`);
  configureMediaProxy(host, port);
}

export function clearServerIp() {
  localStorage.removeItem(KEY);
}

export function hasServerIp() {
  return !!getServerIp();
}

export function buildApiBase(serverIp: string) {
  const host = configuredHost(serverIp);
  const port = addressPort(serverIp, API_PORT);
  if (!validPort(port)) throw new Error("Invalid API server port");
  return `http://${host}:${port}/api/`;
}

export function apiBase() {
  const configured = getServerIp();
  return buildApiBase(configured);
}

export async function checkServerReachable(serverIp: string): Promise<boolean> {
  const host = configuredHost(serverIp);
  const port = addressPort(serverIp, API_PORT);
  return window.iguana?.pingServer ? window.iguana.pingServer(host, port) : false;
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
    if (await checkServerReachable(serverIp)) return;
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
  const configured = getServerIp();
  return {
    key: REVERB_APP_KEY,
    host: configuredHost(configured),
    port: REVERB_PORT,
    scheme: REVERB_SCHEME,
  };
}

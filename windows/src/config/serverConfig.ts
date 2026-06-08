const KEY = "iguana_server_host";

export function getServerHost() {
  return localStorage.getItem(KEY) || "";
}

export function saveServerHost(host: string) {
  const clean = host
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim();

  localStorage.setItem(KEY, clean);
  window.location.reload();
}

export function hasServerHost() {
  return !!getServerHost();
}

export function apiBase() {
  const host = getServerHost();
  if (!host) throw new Error("Server host not configured");
  return `http://${host}:8000/api/`;
}

export function reverbConfig() {
  const host = getServerHost();
  if (!host) throw new Error("Server host not configured");

  return {
    key: "o4ywhiewiedmeup8avwi",
    host,
    port: 8080,
    scheme: "http",
  };
} 
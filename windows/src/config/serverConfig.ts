const KEY = "serverIp";

export function getServerIp() {
  return localStorage.getItem(KEY) || "";
}

export function saveServerIp(serverIp: string) {
  const clean = serverIp
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .trim();

  localStorage.setItem(KEY, clean);
  window.location.reload();
}

export function clearServerIp() {
  localStorage.removeItem(KEY);
  window.location.reload();
}

export function hasServerIp() {
  return !!getServerIp();
}

export function apiBase() {
  return `http://${getServerIp()}:8000/api/`;
}

export function reverbConfig() {
  return {
    key: "o4ywhiewiedmeup8avwi",
    host: getServerIp(),
    port: 8080,
    scheme: "http",
  };
}

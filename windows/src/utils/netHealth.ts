// خفيف: يحدد وضع الشبكة + دوال مهلة/باك-أوف للسيرفر
export type NetMode = "ONLINE_GOOD" | "ONLINE_SLOW" | "SERVER_DOWN" | "OFFLINE";

let serverOpenCircuit = false;
let serverRetryAt = 0;

export function currentNetMode(): NetMode {
  if (!navigator.onLine) return "OFFLINE";
  const down = (navigator as any)?.connection?.downlink as number | undefined;
  if (serverOpenCircuit && Date.now() < serverRetryAt) return "SERVER_DOWN";
  if (typeof down === "number") {
    // اعتبر أقل من 1 Mbps بطيء
    if (down < 1) return "ONLINE_SLOW";
    return "ONLINE_GOOD";
  }
  // ما في API، اعتبر أونلاين جيد
  return "ONLINE_GOOD";
}

export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 2000
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(input, { ...init, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// Circuit breaker للسيرفر
export function tripServerBreaker(ms: number) {
  serverOpenCircuit = true;
  serverRetryAt = Date.now() + ms;
}

export function resetServerBreaker() {
  serverOpenCircuit = false;
  serverRetryAt = 0;
}

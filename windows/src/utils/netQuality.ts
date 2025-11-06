// src/utils/netQuality.ts
export type NetQuality = "GOOD" | "POOR" | "OFFLINE";

type Listener = (q: NetQuality) => void;

const state = {
  quality: "GOOD" as NetQuality,
  listeners: new Set<Listener>(),
  timer: 0 as any,
};

function classify(rttMs: number, success: boolean): NetQuality {
  if (!success) return "OFFLINE";
  if (rttMs <= 300) return "GOOD";
  return "POOR";
}

// Ping صغير بدون كاش
async function probeOnce(signal: AbortSignal): Promise<{ ms: number; ok: boolean }> {
  const url = `/net-ping.txt?ts=${Date.now()}`; // أنشئ ملف صغير ثابت على السيرفر (حتى لو 1B)
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) throw new Error("bad");
    const ms = performance.now() - t0;
    return { ms, ok: true };
  } catch {
    return { ms: 99999, ok: false };
  }
}

export function startNetQualityMonitor(intervalMs = 5000) {
  stopNetQualityMonitor();
  const ctrl = new AbortController();

  async function tick() {
    const res = await probeOnce(ctrl.signal);
    const q = classify(res.ms, res.ok);
    if (q !== state.quality) {
      state.quality = q;
      state.listeners.forEach((fn) => fn(q));
    }
  }

  state.timer = setInterval(tick, intervalMs);
  tick(); // أول قياس الآن

  return () => {
    ctrl.abort();
    stopNetQualityMonitor();
  };
}

export function stopNetQualityMonitor() {
  if (state.timer) clearInterval(state.timer);
  state.timer = 0;
}

export function getNetQuality(): NetQuality {
  return state.quality;
}

export function onNetQualityChange(fn: Listener) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

// src/utils/useServerClockStrict.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { TimeClockApi } from "../Api/Api";

type ServerReply = {
  success?: boolean;
  server_time?: string; // "15:06:04"
  server_date?: string; // "2025-11-22"
  server_epoch_ms?: number; // لحظة بناء الرد على السيرفر (epoch ms)
  server_rx_epoch_ms?: number;
  server_tx_epoch_ms?: number;
  timezone?: string; // "Asia/Beirut"
};

type State = {
  tz: string | null;
  offsetSec: number; // serverDaySec - perfRefDaySec
  anchorPerf: number; // ms من performance.now عند آخر sync
  anchorServerSec: number; // ثواني اليوم عند آخر sync
  lastDriftSec: number;
};

const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY_SEC = 86400;
const DEBUG = true;

// مزامنة كل ساعة
const resyncEveryMs = HOUR;
const maxRttMsForTrust = 1200;
const driftThresholdSec = 0.3;

/* ---------- Helpers ---------- */
const clampDay = (s: number) => ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;

function toSecs(hms: string) {
  const [h = "0", m = "0", s = "0"] = String(hms).split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

function toHHMMSS(s: number) {
  s = clampDay(Math.floor(s));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(
    2,
    "0"
  )}:${String(ss).padStart(2, "0")}`;
}

function group(label: string) {
  if (!DEBUG) return { log: (_: any) => {}, end: () => {} };
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  // console.groupCollapsed(`[⏱️ ServerStrict] ${label} @ ${ts}`);
  return {
    // log: (x: any) => console.log(x),
    // end: () => console.groupEnd(),
  };
}

function epochMsToDaySecs(epochMs: number, tz?: string | null): number {
  const d = new Date(epochMs);

  try {
    if (tz) {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const parts = fmt.formatToParts(d);
      let h = "0",
        m = "0",
        s = "0";
      for (const p of parts) {
        if (p.type === "hour") h = p.value;
        else if (p.type === "minute") m = p.value;
        else if (p.type === "second") s = p.value;
      }
      return toSecs(`${h}:${m}:${s}`);
    }
  } catch {
    // fallback لو Intl/timezone عملت مشكلة
  }

  const hh = d.getHours();
  const mm = d.getMinutes();
  const ss = d.getSeconds();
  return hh * 3600 + mm * 60 + ss;
}

function circularDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > DAY_SEC / 2) d = DAY_SEC - d;
  return d;
}

/* ---------- Global clock engine ---------- */

type EngineState = State & {
  lastRttMs: number;
  lastSyncEpoch: number; // Date.now عند آخر sync
  syncCount: number;
};

let engineState: EngineState | null = null;
let engineStarted = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

async function takeOneSampleNtp(): Promise<EngineState | null> {
  try {
    const t0_perf = performance.now();
    const t0_epoch = Date.now();

    const token = localStorage.getItem("authToken") ?? "";
    const resp = await fetch(TimeClockApi, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const t3_perf = performance.now();
    const t3_epoch = Date.now();
    const rttMs = t3_perf - t0_perf;

    if (!resp.ok) {
      const g = group("SAMPLE_HTTP_FAIL");
      // g.log({ status: resp.status, statusText: resp.statusText });
      // g.end();
      return null;
    }

    let json: ServerReply;
    try {
      json = (await resp.json()) as ServerReply;
    } catch (e) {
      const g = group("SAMPLE_JSON_FAIL");
      // g.log({ error: String(e) });
      // g.end();
      return null;
    }

    const tz =
      json.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

    let baseServerSec: number;
    if (json.server_time) {
      baseServerSec = clampDay(toSecs(json.server_time));
    } else if (json.server_epoch_ms != null) {
      baseServerSec = clampDay(epochMsToDaySecs(json.server_epoch_ms, tz));
    } else {
      baseServerSec = clampDay(epochMsToDaySecs(t3_epoch, tz));
    }

    let serverSec: number;
    if (json.server_epoch_ms != null) {
      const deltaSec = (t3_epoch - json.server_epoch_ms) / 1000;
      serverSec = clampDay(baseServerSec + deltaSec);
    } else {
      // تقريب بسيط: نضيف نص الـ RTT
      const deltaSec = rttMs / 2000;
      serverSec = clampDay(baseServerSec + deltaSec);
    }

    if (rttMs > maxRttMsForTrust) {
      const g = group("SAMPLE_SKIP_BAD_RTT");
      // g.log({ rttMs: rttMs.toFixed(1), reason: "RTT too high" });
      // g.end();
      return null;
    }

    const perfRefDaySec = clampDay(t3_perf / 1000);
    const offsetSec = serverSec - perfRefDaySec;

    const prev = engineState;
    let lastDriftSec = 0;

    if (prev) {
      const expected = clampDay(perfRefDaySec + prev.offsetSec);
      lastDriftSec = circularDiff(serverSec, expected);
    }

    const g = group("SAMPLE");
    // g.log({
    //   tz,
    //   server_time: json.server_time,
    //   server_epoch_ms: json.server_epoch_ms,
    //   rttMs: rttMs.toFixed(1),
    //   serverSec: serverSec.toFixed(3),
    //   perfRef: t3_perf.toFixed(1),
    //   perfRefDaySec: perfRefDaySec.toFixed(3),
    //   offsetSec: offsetSec.toFixed(6),
    //   driftSec: lastDriftSec.toFixed(3),
    //   syncCount: (prev?.syncCount ?? 0) + 1,
    // });
    // g.end();

    return {
      tz,
      offsetSec,
      anchorPerf: t3_perf,
      anchorServerSec: serverSec,
      lastDriftSec,
      lastRttMs: rttMs,
      lastSyncEpoch: t3_epoch,
      syncCount: (prev?.syncCount ?? 0) + 1,
    };
  } catch (e) {
    const g = group("SAMPLE_EXCEPTION");
    // g.log({ error: String(e) });
    // g.end();
    return null;
  }
}

async function singleSync(label: string) {
  const sample = await takeOneSampleNtp();
  if (!sample) return;

  // لا نعمل rebase إذا الانحراف صغير
  if (engineState && sample.lastDriftSec <= driftThresholdSec) {
    engineState = {
      ...engineState,
      tz: sample.tz,
      lastDriftSec: sample.lastDriftSec,
      lastRttMs: sample.lastRttMs,
      lastSyncEpoch: sample.lastSyncEpoch,
      syncCount: sample.syncCount,
    };
  } else {
    engineState = sample;
  }

  const g = group(`${label}_APPLY`);
  // g.log({
  //   tz: engineState.tz,
  //   nowHHMMSS: toHHMMSS(
  //     clampDay(engineState.anchorServerSec) // just for log
  //   ),
  //   offsetSec: engineState.offsetSec.toFixed(6),
  //   lastDriftSec: engineState.lastDriftSec.toFixed(3),
  //   lastRttMs: engineState.lastRttMs.toFixed(1),
  //   syncCount: engineState.syncCount,
  // });
  // g.end();

  notifySubscribers();
}

function ensureEngineStarted() {
  if (engineStarted) return;
  engineStarted = true;

  // أول sync عند التشغيل
  void singleSync("INIT");

  // ثم كل ساعة
  setInterval(() => {
    void singleSync("PERIODIC");
  }, resyncEveryMs);

  // عند رجوع الاتصال
  window.addEventListener("online", () => {
    void singleSync("ONLINE");
  });

  // عند رجوع التبويب للفوكس
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void singleSync("VISIBLE");
    }
  });
}

/* ---------- Hook ---------- */

export function useServerClockStrict() {
  const [, forceRender] = useState(0);

  // fallback محلي للثواني قبل أول sync
  const fallbackRef = useRef<{
    perfRef: number;
    daySecRef: number;
  } | null>(null);

  useEffect(() => {
    ensureEngineStarted();
    const cb = () => forceRender((x) => x + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  const api = useMemo(
    () => {
      return {
        isReady(): boolean {
          return !!engineState;
        },

        nowSecs(): number {
          const st = engineState;

          // قبل أول sync: fallback محلي
          if (!st) {
            if (!fallbackRef.current) {
              const perfRef = performance.now();
              const localDaySec = clampDay(
                epochMsToDaySecs(Date.now(), undefined)
              );
              fallbackRef.current = {
                perfRef,
                daySecRef: localDaySec,
              };
            }

            const perfNow = performance.now();
            const deltaSec = (perfNow - fallbackRef.current.perfRef) / 1000;
            const s = clampDay(fallbackRef.current.daySecRef + deltaSec);

            // if (DEBUG) {
            //   const g = group("NOW_FALLBACK");
            //   g.log({
            //     nowHHMMSS: toHHMMSS(s),
            //     secs: s.toFixed(3),
            //     note: "using local fallback (no server sync yet)",
            //   });
            //   // g.end();
            // }

            return s;
          }

          const perfNow = performance.now();
          const perfNowDaySec = clampDay(perfNow / 1000);
          const s = clampDay(perfNowDaySec + st.offsetSec);

          // if (DEBUG) {
          //   const g = group("NOW");
          //   g.log({
          //     nowHHMMSS: toHHMMSS(s),
          //     secs: s.toFixed(3),
          //     perfNow: perfNow.toFixed(1),
          //     perfNowDaySec: perfNowDaySec.toFixed(3),
          //     offsetSec: st.offsetSec.toFixed(6),
          //   });
          //   g.end();
          // }

          return s;
        },

        msUntil(hms?: string | null): number | undefined {
          if (!hms) return undefined;
          const target = clampDay(toSecs(hms));
          const now = this.nowSecs();
          let delta = target - now;
          if (delta < 0) delta = 0;
          const ms = Math.floor(delta * 1000);

          // if (DEBUG) {
          //   const g = group("MS_UNTIL");
          //   g.log({
          //     target,
          //     targetHHMMSS: hms,
          //     now: now.toFixed(3),
          //     nowHHMMSS: toHHMMSS(now),
          //     msUntil: ms,
          //   });
          //   g.end();
          // }

          return ms;
        },

        driftSec(): number {
          return engineState?.lastDriftSec ?? 0;
        },

        timezone(): string | null {
          return (
            engineState?.tz ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            null
          );
        },

        lastRttMs(): number {
          return engineState?.lastRttMs ?? 0;
        },

        syncCount(): number {
          return engineState?.syncCount ?? 0;
        },

        debugSnapshot() {
          const st = engineState;
          const g = group("SNAPSHOT");
          if (!st) {
            // g.log({ note: "no sync yet (might be using fallback)" });
            // g.end();
            return;
          }
          const now = this.nowSecs();
          // g.log({
          //   tz: st.tz,
          //   anchorServer: toHHMMSS(st.anchorServerSec),
          //   anchorPerf: st.anchorPerf.toFixed(1),
          //   offsetSec: st.offsetSec.toFixed(6),
          //   nowHHMMSS: toHHMMSS(now),
          //   nowSecs: now.toFixed(3),
          //   lastDriftSec: st.lastDriftSec,
          //   lastRttMs: st.lastRttMs,
          //   lastSyncEpoch: new Date(st.lastSyncEpoch).toISOString(),
          //   syncCount: st.syncCount,
          // });
          // g.end();
        },
      };
    },
    [
      /* rerender trigger */
    ]
  );

  return api;
}

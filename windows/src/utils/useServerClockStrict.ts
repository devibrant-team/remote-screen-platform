// src/utils/useServerClockStrict.ts
import { useEffect, useMemo, useState } from "react";
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

// 🔁 مزامنة كل 10 دقائق (بعد ما يصير في server time)
const resyncEveryMs = 10 * 60 * 1000;

// 🔽 حدّ RTT المقبول
const maxRttMsForTrust = 400;

// لو الانحراف أقل من هيك منكمّل على offset القديم بدون rebase
const driftThresholdSec = 0.2;

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
    // fallback لو Intl/timezone عملت مشكلة – بس للـ conversion مش للـ source
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

// 🕒 وقت بداية محاولة الـ sync مع السيرفر
let engineStartEpoch: number | null = null;

// 🟡 عشان ما نكرر الـ alert تبع "ما في وقت"
let noServerTimeAlertShown = false;

// ✅ عشان ما نكرر Alert "رجع الوقت يشتغل"
let serverReadyAlertShown = false;

// 🔒 عشان ما يصير أكتر من طلب sync بنفس الوقت
let syncInFlight = false;

function notifySubscribers() {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

// بعد 30 ثانية من بداية الـ engine، لو بعده ما في server time → alert واحد
function ensureServerOrAlert() {
  if (typeof window === "undefined") return;

  const now = Date.now();

  if (!engineStartEpoch) return;
  if (now - engineStartEpoch < 30_000) return;

  if (!engineState && !noServerTimeAlertShown) {
    noServerTimeAlertShown = true;
    window.alert(
      "⚠️ لم يتم استلام الوقت من السيرفر بعد.\nلا يمكن تشغيل الجدول أو حساب الوقت بدون Server Time."
    );
  }
}

/**
 * أخذ عينة واحدة من السيرفر (نمط NTP مبسط)
 */
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

    if (DEBUG) {
      const g = group("RTT_SAMPLE");
      // g.log({
      //   sentAt_epoch: t0_epoch,
      //   recvAt_epoch: t3_epoch,
      //   diffEpochMs: t3_epoch - t0_epoch,
      //   rttMs: rttMs.toFixed(3),
      //   maxRttMsForTrust,
      // });
      // g.end();
    }

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
      const deltaSec = rttMs / 2000;
      serverSec = clampDay(baseServerSec + deltaSec);
    }

    if (rttMs > maxRttMsForTrust) {
      const g = group("SAMPLE_SKIP_BAD_RTT");
      // g.log({
      //   rttMs: rttMs.toFixed(3),
      //   maxRttMsForTrust,
      //   reason: "RTT too high → skip sample",
      // });
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

    if (DEBUG) {
      const g = group("SAMPLE");
      // g.log({
      //   tz,
      //   server_time: json.server_time,
      //   server_epoch_ms: json.server_epoch_ms,
      //   rttMs: rttMs.toFixed(3),
      //   serverSec: serverSec.toFixed(3),
      //   perfRef: t3_perf.toFixed(1),
      //   perfRefDaySec: perfRefDaySec.toFixed(3),
      //   offsetSec: offsetSec.toFixed(6),
      //   driftSec: lastDriftSec.toFixed(3),
      //   syncCount: (prev?.syncCount ?? 0) + 1,
      // });
      // g.end();
    }

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

/**
 * نأخذ أفضل عيّنة من N محاولات (أقل RTT)
 */
async function bestOfNSamples(n: number): Promise<EngineState | null> {
  const results: EngineState[] = [];

  for (let i = 0; i < n; i++) {
    const s = await takeOneSampleNtp();
    if (s) results.push(s);
  }

  if (!results.length) return null;

  results.sort((a, b) => a.lastRttMs - b.lastRttMs);
  return results[0];
}

async function singleSync(label: string) {
  const sample = await bestOfNSamples(3);
  if (!sample) {
    // ما في sample مقبولة → منظل بلا serverTime
    notifySubscribers();
    return;
  }

  const wasReady = !!engineState && engineState.syncCount > 0;

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

  const isReadyNow = !!engineState && engineState.syncCount > 0;

  if (!wasReady && isReadyNow && typeof window !== "undefined" && !serverReadyAlertShown) {
    serverReadyAlertShown = true;
    window.alert(
      "✅ تم استلام الوقت من السيرفر.\nالآن يمكن تشغيل الجدول وحساب التوقيت بناءً على Server Time."
    );
  }

  if (DEBUG && engineState) {
    const g = group(`${label}_APPLY`);
    // g.log({
    //   tz: engineState.tz,
    //   nowHHMMSS: toHHMMSS(clampDay(engineState.anchorServerSec)),
    //   offsetSec: engineState.offsetSec.toFixed(6),
    //   lastDriftSec: engineState.lastDriftSec.toFixed(3),
    //   lastRttMs: engineState.lastRttMs.toFixed(3),
    //   syncCount: engineState.syncCount,
    // });
    // g.end();
  }

  notifySubscribers();
}

// 🔒 wrapper يمنع تداخل syncs
async function guardedSync(label: string) {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    await singleSync(label);
  } finally {
    syncInFlight = false;
  }
}

function ensureEngineStarted() {
  if (engineStarted) return;
  engineStarted = true;

  engineStartEpoch = Date.now();

  // أول محاولة sync
  void guardedSync("INIT");

  // 🔁 كل 30 ثانية:
  // - لو بعده ما في Server Time → نعمل alert check + نعيد طلب الوقت من السيرفر
  if (typeof window !== "undefined") {
    setInterval(() => {
      if (!engineState || engineState.syncCount <= 0) {
        ensureServerOrAlert();
        void guardedSync("RETRY");
      }
    }, 30_000);
  }

  // ⏰ مزامنة دورية كل 10 دقائق *بعد* ما يكون عندنا وقت جاهز
  setInterval(() => {
    if (engineState && engineState.syncCount > 0) {
      void guardedSync("PERIODIC");
    }
  }, resyncEveryMs);

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      void guardedSync("ONLINE");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void guardedSync("VISIBLE");
      }
    });
  }
}

/* ---------- Hook ---------- */

export function useServerClockStrict() {
  const [, forceRender] = useState(0);

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
          return !!engineState && engineState.syncCount > 0;
        },

        // ❗ الوقت فقط من السيرفر
        // لو ما في server time → نعمل alert check ونرجّع 0 dummy
        nowSecs(): number {
          const st = engineState;

          if (!st || st.syncCount <= 0) {
            ensureServerOrAlert();
            return 0;
          }

          const perfNow = performance.now();
          const perfNowDaySec = clampDay(perfNow / 1000);
          const s = clampDay(perfNowDaySec + st.offsetSec);
          return s;
        },

        // msUntil مبني فقط على وقت السيرفر
        msUntil(hms?: string | null): number | undefined {
          if (!hms) return undefined;

          if (!engineState || engineState.syncCount <= 0) {
            ensureServerOrAlert();
            return undefined;
          }

          const target = clampDay(toSecs(hms));
          const now = this.nowSecs();
          let delta = target - now;
          if (delta < 0) delta = 0;
          const ms = Math.floor(delta * 1000);
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

        source(): "server" | "none" {
          return this.isReady() ? "server" : "none";
        },

        debugSnapshot() {
          const st = engineState;
          const g = group("SNAPSHOT");
          if (!st) {
            // g.log({ note: "no server time yet" });
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
    []
  );

  return api;
}

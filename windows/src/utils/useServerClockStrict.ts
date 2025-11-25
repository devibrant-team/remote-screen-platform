// src/utils/useServerClockStrict.ts
import { useEffect, useMemo, useState } from "react";
import { TimeClockApi } from "../Api/Api";

type ServerReply = {
  success?: boolean;

  server_time?: string; // "15:06:04" (اختياري)
  server_date?: string; // "2025-11-22" (اختياري)

  server_epoch_ms?: number; // لحظة بناء الرد على السيرفر (epoch ms)

  // مهم لـ NTP الحقيقي:
  server_rx_epoch_ms?: number; // t1: لحظة استلام الطلب على السيرفر
  server_tx_epoch_ms?: number; // t2: لحظة إرسال الرد من السيرفر

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

// كل قدّيش نعمل resync دوري (بعد ما يصير في server time)
const resyncEveryMs = 10 * 60 * 1000; // 10 دقائق

// حد RTT المقبول لعينة واحدة
const maxRttMsForTrust = 1200; // 1.2s

// لو الانحراف أقل من هيك منكمّل على offset القديم بدون rebase
const driftThresholdSec = 0.3;

/* ---------- Helpers ---------- */

const clampDay = (s: number) => ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;

function toSecs(hms: string) {
  const [h = "0", m = "0", sPart = "0"] = String(hms).trim().split(":");

  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));

  // هنا نسمح يكون فيها .mmm (مثلاً "13.301")
  let ss = parseFloat(sPart.replace(",", ".")); // احتياط لو رجعت "13,301"
  if (Number.isNaN(ss) || ss < 0) ss = 0;
  if (ss > 59.999) ss = 59.999; // سقف منطقي

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

/**
 * تحويل epoch_ms إلى ثواني اليوم في timezone السيرفر
 */
function epochMsToDaySecs(epochMs: number, tz?: string | null): number {
  const d = new Date(epochMs);

  // جزء الميلي ثانية ضمن الثانية (0..0.999)
  const fracSec = ((epochMs % 1000) + 1000) % 1000 / 1000;

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
      const base = toSecs(`${h}:${m}:${s}`); // هلق toSecs يدعم float ↑
      return clampDay(base + fracSec);
    }
  } catch {
    // لو Intl/timezone عملت مشكلة – نستخدم fallback
  }

  const hh = d.getHours();
  const mm = d.getMinutes();
  const ss = d.getSeconds();
  const ms = d.getMilliseconds();
  const base = hh * 3600 + mm * 60 + ss + ms / 1000;
  return clampDay(base);
}


/** فرق دائري على مستوى اليوم */
function circularDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > DAY_SEC / 2) d = DAY_SEC - d;
  return d;
}

/* ---------- NTP-style Sampling ---------- */

type Sample = {
  tz: string | null;
  offsetSec: number;
  rttMs: number;
  delayMs: number;
  serverSec: number;
  perfRef: number; // t3_perf
  perfRefDaySec: number;
  t3_epoch: number;
};

type EngineState = State & {
  lastRttMs: number;
  lastSyncEpoch: number; // Date.now عند آخر sync
  syncCount: number;
};

let engineState: EngineState | null = null;
let engineStarted = false;
const subscribers = new Set<() => void>();

// وقت بداية محاولة الـ sync مع السيرفر
let engineStartEpoch: number | null = null;

// عشان ما نكرر Alert "ما في وقت من السيرفر"
let noServerTimeAlertShown = false;

// عشان ما نكرر Alert "رجع الوقت"
let serverReadyAlertShown = false;

// عشان ما يصير أكتر من sync بنفس الوقت
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
 * عينة NTP كاملة:
 * t0,t3 من الكلاينت (epoch + perf)
 * t1,t2 من السيرفر (epoch ms)
 */
async function takeOneSampleNtp(): Promise<Sample | null> {
  try {
    // t0: client send
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

    // t3: client receive
    const t3_perf = performance.now();
    const t3_epoch = Date.now();

    if (!resp.ok) {
      console.error("[TimeClock] HTTP FAIL", resp.status, resp.statusText);
      return null;
    }

    let json: ServerReply;
    try {
      json = (await resp.json()) as ServerReply;
    } catch (e) {
      console.error("[TimeClock] JSON FAIL", e);
      return null;
    }

    if (json.success === false) {
      console.error("[TimeClock] API says success=false");
      return null;
    }

    const tz =
      json.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

    // نستخدم t1/t2 من السيرفر لو موجودين (أفضل شيء)
    let t1 = json.server_rx_epoch_ms;
    let t2 = json.server_tx_epoch_ms;

    // fallback: لو ما رجعوا بس عندنا server_epoch_ms
    if (t1 == null && t2 == null && json.server_epoch_ms != null) {
      t1 = json.server_epoch_ms;
      t2 = json.server_epoch_ms;
    }

    if (t1 == null || t2 == null) {
      const g = group("SAMPLE_NTP_NO_T1_T2");
      g.log &&
        g.log({
          note: "missing server_rx_epoch_ms / server_tx_epoch_ms / server_epoch_ms",
        });
      g.end && g.end();
      return null;
    }

    // معادلات NTP
    const delayMs = (t3_epoch - t0_epoch) - (t2 - t1);
    const offsetMs = ((t1 - t0_epoch) + (t2 - t3_epoch)) / 2;
    const rttMs = t3_perf - t0_perf;

    // فلترة العينات السيئة
    if (delayMs < 0 || delayMs > 3000) {
      const g = group("SAMPLE_NTP_SKIP_BAD_DELAY");
      g.log &&
        g.log({
          delayMs,
          reason: "delay too large or negative",
        });
      g.end && g.end();
      return null;
    }

    if (rttMs > maxRttMsForTrust) {
      const g = group("SAMPLE_NTP_SKIP_BAD_RTT");
      g.log &&
        g.log({
          rttMs: rttMs.toFixed(1),
          reason: "RTT too high",
        });
      g.end && g.end();
      return null;
    }

    // وقت السيرفر عند لحظة t3 (من وجهة نظر السيرفر)
    const serverAtT3_epoch = t3_epoch + offsetMs;

    const serverSec = clampDay(epochMsToDaySecs(serverAtT3_epoch, tz));
    const perfRefDaySec = clampDay(t3_perf / 1000);
    const offsetSec = serverSec - perfRefDaySec;

    const g = group("SAMPLE_NTP");
    g.log &&
      g.log({
        tz,
        t0_epoch,
        t1,
        t2,
        t3_epoch,
        delayMs: delayMs.toFixed(1),
        offsetMs: offsetMs.toFixed(3),
        rttMs: rttMs.toFixed(1),
        serverAtT3: new Date(serverAtT3_epoch).toISOString(),
        serverSec: serverSec.toFixed(3),
        perfRef: t3_perf.toFixed(1),
        perfRefDaySec: perfRefDaySec.toFixed(3),
        offsetSec: offsetSec.toFixed(6),
      });
    g.end && g.end();

    return {
      tz,
      offsetSec,
      rttMs,
      delayMs,
      serverSec,
      perfRef: t3_perf,
      perfRefDaySec,
      t3_epoch,
    };
  } catch (e) {
    console.error("[TimeClock] EXCEPTION", e);
    return null;
  }
}

/**
 * نأخذ أفضل عينة من N محاولات (أقل RTT)
 */
async function bestOfNSamples(n: number): Promise<EngineState | null> {
  const results: Sample[] = [];

  for (let i = 0; i < n; i++) {
    const s = await takeOneSampleNtp();
    if (s) results.push(s);
  }

  if (!results.length) return null;

  results.sort((a, b) => a.rttMs - b.rttMs);
  const best = results[0];

  const prev = engineState;
  let lastDriftSec = 0;

  if (prev) {
    const expected = clampDay(best.perfRefDaySec + prev.offsetSec);
    lastDriftSec = circularDiff(best.serverSec, expected);
  }

  return {
    tz: best.tz,
    offsetSec: best.offsetSec,
    anchorPerf: best.perfRef,
    anchorServerSec: best.serverSec,
    lastDriftSec,
    lastRttMs: best.rttMs,
    lastSyncEpoch: best.t3_epoch,
    syncCount: (prev?.syncCount ?? 0) + 1,
  };
}

async function singleSync(label: string) {
  const sample = await bestOfNSamples(3);
  if (!sample) {
    // ما في sample مقبولة → نضل بلا serverTime
    notifySubscribers();
    return;
  }

  const wasReady = !!engineState && engineState.syncCount > 0;

  if (engineState && sample.lastDriftSec <= driftThresholdSec) {
    // drift بسيط → نحدّث meta فقط بدون تغيير offset
    engineState = {
      ...engineState,
      tz: sample.tz,
      lastDriftSec: sample.lastDriftSec,
      lastRttMs: sample.lastRttMs,
      lastSyncEpoch: sample.lastSyncEpoch,
      syncCount: sample.syncCount,
    };
  } else {
    // drift كبير أو أول مرة → rebase كامل
    engineState = sample;
  }

  const isReadyNow = !!engineState && engineState.syncCount > 0;

  if (
    !wasReady &&
    isReadyNow &&
    typeof window !== "undefined" &&
    !serverReadyAlertShown
  ) {
    serverReadyAlertShown = true;
    window.alert(
      "✅ تم استلام الوقت من السيرفر.\nالآن يمكن تشغيل الجدول وحساب التوقيت بناءً على Server Time."
    );
  }

  if (DEBUG && engineState) {
    const g = group(`${label}_APPLY`);
    g.log &&
      g.log({
        tz: engineState.tz,
        nowHHMMSS: toHHMMSS(clampDay(engineState.anchorServerSec)),
        offsetSec: engineState.offsetSec.toFixed(6),
        lastDriftSec: engineState.lastDriftSec.toFixed(3),
        lastRttMs: engineState.lastRttMs.toFixed(3),
        syncCount: engineState.syncCount,
      });
    g.end && g.end();
  }

  notifySubscribers();
}

// wrapper يمنع تداخل syncs
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

  // كل 30 ثانية:
  // - لو بعده ما في Server Time → alert + إعادة طلب الوقت
  if (typeof window !== "undefined") {
    setInterval(() => {
      if (!engineState || engineState.syncCount <= 0) {
        ensureServerOrAlert();
        void guardedSync("RETRY");
      }
    }, 30_000);
  }

  // مزامنة دورية كل resyncEveryMs بعد ما يكون في وقت جاهز
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

/* ---------- React Hook ---------- */

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

        /** ثواني اليوم (0..86399) حسب ساعة السيرفر فقط */
        nowSecs(): number {
          const st = engineState;

          if (!st || st.syncCount <= 0) {
            ensureServerOrAlert();
            return 0;
          }

          const perfNow = performance.now();
          const perfNowDaySec = clampDay(perfNow / 1000);
          const s = clampDay(perfNowDaySec + st.offsetSec);

          if (DEBUG) {
            const g = group("NOW");
            g.log &&
              g.log({
                nowHHMMSS: toHHMMSS(s),
                secs: s.toFixed(3),
                perfNow: perfNow.toFixed(1),
                perfNowDaySec: perfNowDaySec.toFixed(3),
                offsetSec: st.offsetSec.toFixed(6),
              });
            g.end && g.end();
          }

          return s;
        },

        /** كم ms إلى HH:mm:ss ضمن نفس اليوم (بدون لف لليوم التالي) */
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

          const g = group("MS_UNTIL");
          g.log &&
            g.log({
              target,
              targetHHMMSS: hms,
              now: now.toFixed(3),
              nowHHMMSS: toHHMMSS(now),
              msUntil: ms,
            });
          g.end && g.end();

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
            g.log && g.log({ note: "no server time yet" });
            g.end && g.end();
            return;
          }
          const now = this.nowSecs();
          g.log &&
            g.log({
              tz: st.tz,
              anchorServer: toHHMMSS(st.anchorServerSec),
              anchorPerf: st.anchorPerf.toFixed(1),
              offsetSec: st.offsetSec.toFixed(6),
              nowHHMMSS: toHHMMSS(now),
              nowSecs: now.toFixed(3),
              lastDriftSec: st.lastDriftSec,
              lastRttMs: st.lastRttMs,
              lastSyncEpoch: new Date(st.lastSyncEpoch).toISOString(),
              syncCount: st.syncCount,
            });
          g.end && g.end();
        },
      };
    },
    []
  );

  return api;
}

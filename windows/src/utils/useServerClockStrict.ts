// src/utils/useServerClockStrict.ts
import { useEffect, useMemo, useState } from "react";
import { TimeClockApi } from "../Api/Api";
import { loadDeviceStateSync } from "./deviceState";
import { showServerToast } from "./serverClockToast";

type ServerReply = {
  success?: boolean;
  server_time?: string;
  server_date?: string;
  server_epoch_ms?: number;
  server_rx_epoch_ms?: number;
  server_tx_epoch_ms?: number;
  timezone?: string;
};

type State = {
  tz: string | null;
  offsetSec: number;
  anchorPerf: number;
  anchorServerSec: number;
  lastDriftSec: number;
};

const SEC = 1000;
const DAY_SEC = 86400;

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

  let ss = parseFloat(sPart.replace(",", "."));
  if (Number.isNaN(ss) || ss < 0) ss = 0;
  if (ss > 59.999) ss = 59.999;

  return hh * 3600 + mm * 60 + ss;
}

/**
 * تحويل epoch_ms إلى ثواني اليوم في timezone السيرفر
 */
function epochMsToDaySecs(epochMs: number, tz?: string | null): number {
  const d = new Date(epochMs);
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
      const base = toSecs(`${h}:${m}:${s}`);
      return clampDay(base + fracSec);
    }
  } catch {
    // fallback عادي بدون timezone
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
  perfRef: number;
  perfRefDaySec: number;
  t3_epoch: number;
};

type EngineState = State & {
  lastRttMs: number;
  lastSyncEpoch: number;
  syncCount: number;
};

let engineState: EngineState | null = null;
let engineStarted = false;
const subscribers = new Set<() => void>();

let engineStartEpoch: number | null = null;
let noServerTimeAlertShown = false;
let serverReadyAlertShown = false;
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

// بعد 30 ثانية من بداية الـ engine، لو بعده ما في server time → toast واحد
function ensureServerOrAlert() {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (!engineStartEpoch) return;
  if (now - engineStartEpoch < 30_000) return;

  if (!engineState && !noServerTimeAlertShown) {
    const { linked, token } = loadDeviceStateSync();
    if (!linked || !token) return;

    noServerTimeAlertShown = true;

    // Toast بدل window.alert
    showServerToast(
      "⚠️ لم يتم استلام الوقت من السيرفر بعد. لا يمكن تشغيل الجدول أو حساب الوقت بدون Server Time.",
      "warning"
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
    const token = localStorage.getItem("authToken") ?? "";
    if (!token) {
      return null;
    }

    // t0: client send
    const t0_perf = performance.now();
    const t0_epoch = Date.now();

    const resp = await fetch(TimeClockApi, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    // t3: client receive
    const t3_perf = performance.now();
    const t3_epoch = Date.now();

    if (!resp.ok) {
      return null;
    }

    let json: ServerReply;
    try {
      json = (await resp.json()) as ServerReply;
    } catch {
      return null;
    }

    if (json.success === false) {
      return null;
    }

    const tz =
      json.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

    let t1 = json.server_rx_epoch_ms;
    let t2 = json.server_tx_epoch_ms;

    if (t1 == null && t2 == null && json.server_epoch_ms != null) {
      t1 = json.server_epoch_ms;
      t2 = json.server_epoch_ms;
    }

    if (t1 == null || t2 == null) {
      return null;
    }

    const delayMs = t3_epoch - t0_epoch - (t2 - t1);
    const offsetMs = ((t1 - t0_epoch) + (t2 - t3_epoch)) / 2;
    const rttMs = t3_perf - t0_perf;

    if (delayMs < 0 || delayMs > 3000) return null;
    if (rttMs > maxRttMsForTrust) return null;

    const serverAtT3_epoch = t3_epoch + offsetMs;

    const serverSec = clampDay(epochMsToDaySecs(serverAtT3_epoch, tz));
    const perfRefDaySec = clampDay(t3_perf / 1000);
    const offsetSec = serverSec - perfRefDaySec;

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
  } catch {
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

  if (
    !wasReady &&
    isReadyNow &&
    typeof window !== "undefined" &&
    !serverReadyAlertShown
  ) {
    serverReadyAlertShown = true;

    // Toast بدل window.alert
    showServerToast(
      "✅ تم استلام الوقت من السيرفر. الآن يمكن تشغيل الجدول وحساب التوقيت بناءً على Server Time.",
      "success"
    );
  }

  notifySubscribers();
}

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

  const { screenId, linked, token } = loadDeviceStateSync();
  if (!linked || !screenId || !token) {
    engineStarted = true;
    return;
  }

  engineStarted = true;
  engineStartEpoch = Date.now();

  void guardedSync("INIT");

  if (typeof window !== "undefined") {
    setInterval(() => {
      if (!engineState || engineState.syncCount <= 0) {
        ensureServerOrAlert();
        void guardedSync("RETRY");
      }
    }, 30_000);
  }

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
    () => ({
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
        if (!st) {
          return {
            note: "no server time yet",
          };
        }
        const now = this.nowSecs();
        return {
          tz: st.tz,
          anchorServerSec: st.anchorServerSec,
          anchorPerf: st.anchorPerf,
          offsetSec: st.offsetSec,
          nowSecs: now,
          lastDriftSec: st.lastDriftSec,
          lastRttMs: st.lastRttMs,
          lastSyncEpoch: st.lastSyncEpoch,
          syncCount: st.syncCount,
        };
      },
    }),
    []
  );

  return api;
}

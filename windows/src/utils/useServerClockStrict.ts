// src/utils/useServerClockStrict.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { TimeClockApi } from "../Api/Api";

type ServerReply = {
  success?: boolean;

  server_time?: string;          // "19:47:30" (اختياري)
  server_date?: string;          // "2025-11-20" (اختياري)

  server_epoch_ms?: number;      // epoch ms عند لحظة بناء الرد (fallback)

  // 🧠 مهم لمزامنة NTP:
  server_rx_epoch_ms?: number;   // t1: لحظة استلام الطلب على السيرفر
  server_tx_epoch_ms?: number;   // t2: لحظة إرسال الرد من السيرفر

  timezone?: string;             // "Asia/Beirut"
};

type State = {
  tz: string | null;

  /** offsetSec = serverDaySec - perfRefDaySec (من آخر rebase فعال) */
  offsetSec: number;

  /** مرجع للمزامنة (معلوماتية للـ debug) */
  anchorPerf: number;       // ms من performance.now عند آخر rebase
  anchorServerSec: number;  // ثواني اليوم عند آخر rebase

  /** آخر انحراف مقاس بالثواني */
  lastDriftSec: number;
};

const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY_SEC = 86400;
const DEBUG = true;

// 🔧 حساسية المزامنة
const driftThresholdSec = 0.3;      // أقصى drift مقبول قبل rebase (0.3 ثانية)
const resyncEveryMs = HOUR;         // مزامنة دورية
const maxRttMsForTrust = 1200;      // أقصى RTT نثق فيه لعينة واحدة (1.2s)

// 🔧 إعدادات Burst الأولي
const burstSamplesCount = 7;        // عدد العينات في الـ Burst
const burstDelayMs = 180;           // تأخير بسيط بين العينات
const maxBurstRttMs = 600;          // الحد الأقصى للـ RTT لنعتبره ممتاز للـ Burst
const minGoodSamplesForBurst = 3;   // أقل عدد عينات جيدة لقبول Burst

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
  console.groupCollapsed(`[⏱️ ServerStrict] ${label} @ ${ts}`);
  return {
    log: (x: any) => console.log(x),
    end: () => console.groupEnd(),
  };
}

/**
 * تحويل epoch_ms إلى ثواني اليوم في timezone السيرفر
 */
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
  perfRef: number;       // t3_perf
  perfRefDaySec: number; // clampDay(t3_perf / 1000)
};

/**
 * NTP-like sample:
 * t0,t3 من الكلاينت (epoch + perf)
 * t1,t2 من السيرفر (epoch ms)
 */
async function takeOneSampleNtp(): Promise<Sample | null> {
  // t0: client send
  const t0_perf = performance.now();
  const t0_epoch = Date.now();

  const token = localStorage.getItem("authToken") ?? "";
  const resp = await fetch(TimeClockApi, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  // t3: client receive
  const t3_perf = performance.now();
  const t3_epoch = Date.now();

  if (!resp.ok) return null;
  const json: ServerReply = await resp.json();

  const tz = json.timezone ?? null;

  // نحاول استخدام t1,t2 من السيرفر (أفضل شيء)
  let t1 = json.server_rx_epoch_ms;
  let t2 = json.server_tx_epoch_ms;

  // fallback لو السيرفر ما رجّعهم لكن رجّع server_epoch_ms
  if (t1 == null && t2 == null && json.server_epoch_ms != null) {
    t1 = json.server_epoch_ms;
    t2 = json.server_epoch_ms;
  }

  if (t1 == null || t2 == null) {
    const g = group("SAMPLE_NTP_NO_T1_T2");
    g.log({
      note: "missing server_rx_epoch_ms / server_tx_epoch_ms / server_epoch_ms",
    });
    g.end();
    return null;
  }

  // NTP equations
  const delayMs = (t3_epoch - t0_epoch) - (t2 - t1);
  const offsetMs = ((t1 - t0_epoch) + (t2 - t3_epoch)) / 2;
  const rttMs = t3_perf - t0_perf;

  // فلترة العينات السيئة
  if (delayMs < 0 || delayMs > 3000) {
    const g = group("SAMPLE_NTP_SKIP_BAD_DELAY");
    g.log({
      delayMs,
      reason: "delay too large or negative",
    });
    g.end();
    return null;
  }

  if (rttMs > maxRttMsForTrust) {
    const g = group("SAMPLE_NTP_SKIP_BAD_RTT");
    g.log({
      rttMs: rttMs.toFixed(1),
      reason: "RTT too high",
    });
    g.end();
    return null;
  }

  // وقت السيرفر عند لحظة t3 (client receive)
  const serverAtT3_epoch = t3_epoch + offsetMs;

  const serverSec = clampDay(epochMsToDaySecs(serverAtT3_epoch, tz));
  const perfRefDaySec = clampDay(t3_perf / 1000);
  const offsetSec = serverSec - perfRefDaySec;

  const g = group("SAMPLE_NTP");
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
  g.end();

  return {
    tz,
    offsetSec,
    rttMs,
    delayMs,
    serverSec,
    perfRef: t3_perf,
    perfRefDaySec,
  };
}

/**
 * Burst أولي:
 * - عدة عينات NTP
 * - اختيار أفضل العينات (RTT صغير)
 * - weighted average للـ offsetSec
 */
async function runBurstInit(): Promise<State | null> {
  const samples: Sample[] = [];

  for (let i = 0; i < burstSamplesCount; i++) {
    const s = await takeOneSampleNtp();
    if (s && s.rttMs <= maxBurstRttMs) {
      samples.push(s);
    }
    if (i < burstSamplesCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, burstDelayMs));
    }
  }

  if (samples.length < minGoodSamplesForBurst) {
    const g = group("BURST_FAIL");
    g.log({
      note: "Not enough good samples, fallback to single sync",
      goodSamples: samples.length,
    });
    g.end();
    return null;
  }

  // نرتّب حسب RTT ونستخدم أفضل نصف تقريبا
  samples.sort((a, b) => a.rttMs - b.rttMs);
  const used = samples.slice(
    0,
    Math.max(minGoodSamplesForBurst, Math.ceil(samples.length / 2))
  );

  let weightedOffsetSum = 0;
  let weightSum = 0;
  let anchor = used[0];

  for (const s of used) {
    const w = 1 / Math.max(1, s.rttMs * s.rttMs); // وزن أعلى ل RTT الأصغر
    weightedOffsetSum += s.offsetSec * w;
    weightSum += w;
    if (s.rttMs < anchor.rttMs) anchor = s;
  }

  const finalOffset = weightedOffsetSum / weightSum;

  const g = group("BURST_INIT");
  g.log({
    samples: samples.length,
    usedSamples: used.length,
    offsets: used.map((s) => s.offsetSec.toFixed(6)),
    rtts: used.map((s) => s.rttMs.toFixed(1)),
    finalOffsetSec: finalOffset.toFixed(6),
    anchorServer: toHHMMSS(anchor.serverSec),
    anchorPerf: anchor.perfRef.toFixed(1),
  });
  g.end();

  return {
    tz: anchor.tz,
    offsetSec: finalOffset,
    anchorPerf: anchor.perfRef,
    anchorServerSec: anchor.serverSec,
    lastDriftSec: 0,
  };
}

/**
 * ساعة سيرفر صارمة مبنية على:
 * - NTP-style sampling
 * - performance.now() + offsetSec
 */
export function useServerClockStrict() {
  const st = useRef<State | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: number | null = null;

    const singleSync = async (label: string) => {
      const s = await takeOneSampleNtp();
      if (!s) return;

      // أول sync (إذا ما صار burst أو burst رجّع null)
      if (!st.current) {
        st.current = {
          tz: s.tz,
          offsetSec: s.offsetSec,
          anchorPerf: s.perfRef,
          anchorServerSec: s.serverSec,
          lastDriftSec: 0,
        };

        const g = group(`${label}_INIT`);
        g.log({
          tz: s.tz,
          server_now: toHHMMSS(s.serverSec),
          perfRef: s.perfRef.toFixed(1),
          perfRefDaySec: s.perfRefDaySec.toFixed(3),
          offsetSec: s.offsetSec.toFixed(6),
          rttMs: s.rttMs.toFixed(1),
          delayMs: s.delayMs.toFixed(1),
        });
        g.end();

        setTick((x) => x + 1);
        return;
      }

      // عند وجود حالة قديمة: نقيس drift بين المتوقع واللي رجع
      const prev = st.current;
      const expected = clampDay(s.perfRefDaySec + prev.offsetSec);
      const drift = circularDiff(s.serverSec, expected);

      const g = group(`${label}_CHECK`);
      g.log({
        tz: s.tz,
        server_now: toHHMMSS(s.serverSec),
        expected_now: toHHMMSS(expected),
        driftSec: drift.toFixed(3),
        rttMs: s.rttMs.toFixed(1),
        delayMs: s.delayMs.toFixed(1),
        status:
          drift <= driftThresholdSec
            ? "✅ within threshold"
            : "❗candidate for rebase",
      });
      g.end();

      if (drift <= driftThresholdSec) {
        // drift بسيط → ما نغيّر offset، بس نحدّث meta
        st.current = {
          ...prev,
          tz: s.tz,
          lastDriftSec: drift,
        };
        setTick((x) => x + 1);
        return;
      }

      // drift كبير → rebase جديد بنفس منطق NTP sample
      st.current = {
        tz: s.tz,
        offsetSec: s.offsetSec,
        anchorPerf: s.perfRef,
        anchorServerSec: s.serverSec,
        lastDriftSec: drift,
      };

      const g2 = group(`${label}_REBASE`);
      g2.log({
        tz: s.tz,
        server_now: toHHMMSS(s.serverSec),
        perfRef: s.perfRef.toFixed(1),
        perfRefDaySec: s.perfRefDaySec.toFixed(3),
        newOffsetSec: s.offsetSec.toFixed(6),
        driftBefore: drift.toFixed(3),
        rttMs: s.rttMs.toFixed(1),
        delayMs: s.delayMs.toFixed(1),
      });
      g2.end();

      setTick((x) => x + 1);
    };

    const init = async () => {
      // 1️⃣ Burst أولي
      const burstState = await runBurstInit();
      if (burstState) {
        st.current = burstState;
        setTick((x) => x + 1);
      } else {
        // 2️⃣ لو Burst فشل → Sync واحد
        await singleSync("SYNC_INIT_SINGLE");
      }
    };

    void init();

    // مزامنة دورية
    timer = window.setInterval(() => {
      void singleSync("SYNC_PERIODIC");
    }, resyncEveryMs) as unknown as number;

    // مزامنة عند رجوع النت أو رجوع التبويب
    const onOnline = () => {
      void singleSync("SYNC_ONLINE");
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void singleSync("SYNC_VISIBLE");
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const api = useMemo(() => {
    return {
      /** ثواني اليوم حسب ساعة السيرفر (0..86399 تقريباً) */
      nowSecs(): number {
        const state = st.current;
        if (!state) return 0; // قبل أول مزامنة

        const perfNow = performance.now();
        const perfNowDaySec = clampDay(perfNow / 1000);
        const s = clampDay(perfNowDaySec + state.offsetSec);

        if (DEBUG) {
          const g = group("NOW");
          g.log({
            nowHHMMSS: toHHMMSS(s),
            secs: s.toFixed(3),
            perfNow: perfNow.toFixed(1),
            perfNowDaySec: perfNowDaySec.toFixed(3),
            offsetSec: state.offsetSec.toFixed(6),
          });
          g.end();
        }

        return s;
      },

      /** كم ميلي ثانية حتى HH:mm:ss ضمن نفس اليوم (بدون لف لليوم التالي) */
      msUntil(hms?: string | null): number | undefined {
        if (!hms || !st.current) return undefined;
        const target = clampDay(toSecs(hms));
        const now = this.nowSecs();
        let delta = target - now;
        if (delta < 0) delta = 0; // ما منلف لليوم اللي بعده
        const ms = Math.floor(delta * 1000);

        if (DEBUG) {
          const g = group("MS_UNTIL");
          g.log({
            target,
            targetHHMMSS: hms,
            now: now.toFixed(3),
            nowHHMMSS: toHHMMSS(now),
            msUntil: ms,
          });
          g.end();
        }

        return ms;
      },

      /** آخر انحراف مقاس بالثواني */
      driftSec(): number {
        return st.current?.lastDriftSec ?? 0;
      },

      /** المنطقة الزمنية من آخر مزامنة – معلوماتية فقط */
      timezone(): string | null {
        return st.current?.tz ?? null;
      },

      /** Snapshot للـ debug */
      debugSnapshot() {
        const state = st.current;
        const g = group("SNAPSHOT");
        if (!state) {
          g.log({ note: "no sync yet" });
          g.end();
          return;
        }
        const now = this.nowSecs();
        g.log({
          tz: state.tz,
          anchorServer: toHHMMSS(state.anchorServerSec),
          anchorPerf: state.anchorPerf.toFixed(1),
          offsetSec: state.offsetSec.toFixed(6),
          nowHHMMSS: toHHMMSS(now),
          nowSecs: now.toFixed(3),
          lastDriftSec: state.lastDriftSec,
        });
        g.end();
      },
    };
  }, [tick]);

  return api;
}

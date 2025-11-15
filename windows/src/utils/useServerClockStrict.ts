import { useEffect, useMemo, useRef, useState } from "react";
import { TimeClockApi } from "../Api/Api";

type ServerReply = {
  success?: boolean;
  server_time?: string;
  timezone?: string;
};

type State = {
  tz: string | null;

  /** offsetSec = serverDaySec - perfMidDaySec (من آخر rebase كبير) */
  offsetSec: number;

  /** لحظة مزامنة مرجعية (perfMid) – معلوماتية فقط للـ debug */
  anchorPerf: number; // ms
  anchorServerSec: number; // ثواني اليوم عند آخر rebase

  /** آخر انحراف مقاس بالثواني */
  lastDriftSec: number;
};

const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY_SEC = 86400;
const DEBUG = true;
const driftThresholdSec = 2; // فرق مسموح (ثواني) قبل ما نعمل rebase
const resyncEveryMs = HOUR; // تحقق كل ساعة

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
 * جلب وقت السيرفر كنص HH:mm:ss وتحويله لثواني اليوم.
 * ملاحظة: هون ما منقيس performance، بس منرجّع secs + tz.
 */
async function fetchServerSecs(): Promise<{
  tz: string | null;
  secs: number;
} | null> {
  try {
    const token = localStorage.getItem("authToken") ?? "";
    const resp = await fetch(TimeClockApi, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) return null;
    const json: ServerReply = await resp.json();
    if (!json?.server_time) return null;
    const secs = toSecs(json.server_time);
    const g = group("FETCH");
    g.log({
      sentToken: !!token,
      server_time: json.server_time,
      tz: json.timezone,
      secs,
    });
    g.end();
    return { tz: json.timezone ?? null, secs };
  } catch (e) {
    const g = group("FETCH_ERR");
    g.log({ error: String(e) });
    g.end();
    return null;
  }
}

/** فرق دائري على مستوى اليوم: لو لفّينا من 23:59 → 00:00 */
function circularDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > DAY_SEC / 2) d = DAY_SEC - d;
  return d;
}

/**
 * ساعة تشغيل مبنية على:
 * - وقت السيرفر (server_time HH:mm:ss) كنقطة مرجعية
 * - performance.now() + offsetSec
 * بدون استخدام Date.now أو ساعة الجهاز.
 */
export function useServerClockStrict() {
  const st = useRef<State | null>(null);
  const [tick, setTick] = useState(0); // لتحفيز useMemo بعد المزامنة

  useEffect(() => {
    let timer: number | null = null;

    const sync = async () => {
      // نقيّس RTT حول طلب السيرفر
      const perfStart = performance.now();
      const r = await fetchServerSecs();
      const perfEnd = performance.now();

      if (!r) return;

      const rttMs = perfEnd - perfStart;
      const perfMid = perfStart + rttMs / 2; // تقريب للّحظة اللي كان فيها server_time
      const perfMidDaySec = clampDay(perfMid / 1000);
      const serverSec = clampDay(r.secs);

      // أول مزامنة → نعمل rebase كامل
      if (!st.current) {
        const offsetSec = serverSec - perfMidDaySec; // ممكن يكون سالب، ما في مشكلة
        st.current = {
          tz: r.tz,
          offsetSec,
          anchorPerf: perfMid,
          anchorServerSec: serverSec,
          lastDriftSec: 0,
        };
        const g = group("SYNC_INIT");
        g.log({
          tz: r.tz,
          server_now: toHHMMSS(serverSec),
          perfMid: perfMid.toFixed(1),
          perfMidDaySec: perfMidDaySec.toFixed(3),
          offsetSec: offsetSec.toFixed(3),
          rttMs: rttMs.toFixed(1),
        });
        g.end();
        setTick((x) => x + 1);
        return;
      }

      // عند وجود حالة قديمة: نقيس الانحراف بين توقّعاتنا والوقت الجديد
      const prev = st.current;
      const expected = clampDay(perfMidDaySec + prev.offsetSec);
      const drift = circularDiff(serverSec, expected);

      const g = group("SYNC_CHECK");
      g.log({
        tz: r.tz,
        server_now: toHHMMSS(serverSec),
        expected_now: toHHMMSS(expected),
        driftSec: drift.toFixed(3),
        rttMs: rttMs.toFixed(1),
        status: drift <= driftThresholdSec ? "✅ within threshold" : "❗rebase",
      });
      g.end();

      if (drift <= driftThresholdSec) {
        // انحراف بسيط → نحدّث فقط المعلومات
        st.current = {
          ...prev,
          tz: r.tz,
          lastDriftSec: drift,
        };
        setTick((x) => x + 1);
        return;
      }

      // انحراف كبير → rebase جديد (نحسب offsetSec من الصفر)
      const newOffset = serverSec - perfMidDaySec;
      st.current = {
        tz: r.tz,
        offsetSec: newOffset,
        anchorPerf: perfMid,
        anchorServerSec: serverSec,
        lastDriftSec: drift,
      };
      const g2 = group("SYNC_REBASE");
      g2.log({
        tz: r.tz,
        server_now: toHHMMSS(serverSec),
        perfMid: perfMid.toFixed(1),
        perfMidDaySec: perfMidDaySec.toFixed(3),
        newOffsetSec: newOffset.toFixed(3),
        driftBefore: drift.toFixed(3),
      });
      g2.end();

      setTick((x) => x + 1);
    };

    // أول مزامنة فوراً
    void sync();

    // مزامنة دورية (كل ساعة حالياً)
    timer = window.setInterval(sync, resyncEveryMs) as unknown as number;

    // إعادة مزامنة عند رجوع النت أو رجوع التبويب
    const onOnline = () => void sync();
    const onVis = () => {
      if (document.visibilityState === "visible") void sync();
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
        if (!state) return 0; // إلى أن تتم أول مزامنة

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
            offsetSec: state.offsetSec.toFixed(3),
          });
          g.end();
        }

        return s;
      },

      /** كم ميلي ثانية حتى HH:mm:ss ضمن نفس اليوم */
      msUntil(hms?: string | null): number | undefined {
        if (!hms || !st.current) return undefined;
        const target = clampDay(toSecs(hms));
        const now = this.nowSecs();
        let delta = target - now;
        if (delta < 0) delta = 0; // ما منلف لليوم التاني هون
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

      /** آخر انحراف مقاس (|expected - server|) بالثواني */
      driftSec(): number {
        return st.current?.lastDriftSec ?? 0;
      },

      /** المنطقة الزمنية من آخر مزامنة – معلوماتية فقط */
      timezone(): string | null {
        return st.current?.tz ?? null;
      },

      /** لوج تفصيلي لحالة الساعة */
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
          offsetSec: state.offsetSec.toFixed(3),
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

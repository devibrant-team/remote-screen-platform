import { useEffect, useMemo, useRef, useState } from "react";
import { TimeClockApi } from "../Api/Api";

type ServerReply = { success?: boolean; server_time?: string; timezone?: string };

type State = {
  tz: string | null;
  baseServerSecs: number; // seconds-of-day وقت آخر مزامنة
  basePerf: number;       // performance.now() لحظة المزامنة
  lastDriftSec: number;   // |expected - actual|
};

const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY_SEC = 86400;
const DEBUG = true;
const driftThresholdSec = 2;   // اختلاف مسموح عند التحقق
const resyncEveryMs = HOUR;    // تحقق كل ساعة

/* ---------- Helpers ---------- */
const clampDay = (s: number) => ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;

function toSecs(hms: string) {
  const [h="0", m="0", s="0"] = String(hms).split(":");
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
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
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
async function fetchServerSecs(): Promise<{ tz: string|null; secs: number }|null> {
  try {
    const token = localStorage.getItem("authToken") ?? "";
    const resp = await fetch(TimeClockApi, {
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const json: ServerReply = await resp.json();
    if (!json?.server_time) return null;
    const secs = toSecs(json.server_time);
    const g = group("FETCH");
    g.log({ sentToken: !!token, server_time: json.server_time, tz: json.timezone, secs });
    g.end();
    return { tz: json.timezone ?? null, secs };
  } catch (e) {
    const g = group("FETCH_ERR");
    g.log({ error: String(e) });
    g.end();
    return null;
  }
}

/**
 * وقت تشغيل صارم مبني على لقطة السيرفر + عدّاد performance.now()
 * لا يستخدم Date.now() أبداً.
 */
export function useServerClockStrict() {
  const st = useRef<State | null>(null);
  const [tick, setTick] = useState(0); // لتحفيز useMemo بعد المزامنة

  useEffect(() => {
    let timer: number | null = null;

    const sync = async () => {
      const r = await fetchServerSecs();
      if (!r) return;
      const nowPerf = performance.now();

      if (!st.current) {
        // أول لقطة
        st.current = {
          tz: r.tz,
          baseServerSecs: r.secs,
          basePerf: nowPerf,
          lastDriftSec: 0,
        };
        const g = group("SYNC_INIT");
        g.log({ baseServer: toHHMMSS(r.secs), basePerf: nowPerf.toFixed(1) });
        g.end();
        setTick(x => x + 1);
        return;
      }

      // توقّع أين يجب أن نكون الآن حسب العدّاد
      const elapsedSec = (nowPerf - st.current.basePerf) / 1000;
      const expected = clampDay(st.current.baseServerSecs + elapsedSec);
      const drift = Math.abs(clampDay(r.secs - expected));

      const g = group("SYNC_CHECK");
      g.log({
        tz: r.tz,
        server_now: toHHMMSS(r.secs),
        expected_now: toHHMMSS(expected),
        driftSec: drift.toFixed(3),
        status: drift <= driftThresholdSec ? "✅ within threshold" : "❗rebase",
      });
      g.end();

      // إنحراف بسيط → حدّث فقط المقاييس، بدون rebase
      if (drift <= driftThresholdSec) {
        st.current.tz = r.tz;
        st.current.lastDriftSec = drift;
        setTick(x => x + 1);
        return;
      }

      // إنحراف كبير → أعد الضبط على لقطة السيرفر
      st.current = {
        tz: r.tz,
        baseServerSecs: r.secs,
        basePerf: nowPerf,
        lastDriftSec: drift,
      };
      setTick(x => x + 1);
    };

    // أول مزامنة فورًا
    void sync();

    // كل ساعة
    timer = window.setInterval(sync, resyncEveryMs) as unknown as number;

    // إعادة مزامنة عند رجوع النت أو التبويب
    const onOnline = () => void sync();
    const onVis = () => { if (document.visibilityState === "visible") void sync(); };
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
      /** ثواني اليوم المعتمدة للتشغيل (من دون ساعة الجهاز) */
      nowSecs(): number {
        if (!st.current) return 0; // إلى أن تصل أول مزامنة
        const elapsedSec = (performance.now() - st.current.basePerf) / 1000;
        const s = clampDay(st.current.baseServerSecs + elapsedSec);
        if (DEBUG) {
          const g = group("NOW");
          g.log({ now: toHHMMSS(s), secs: s.toFixed(3) });
          g.end();
        }
        return s;
      },

      /** كم ميلي ثانية حتى HH:mm:ss (ضمن نفس اليوم) بناءً على عدّاد السيرفر */
      msUntil(hms?: string | null): number | undefined {
        if (!hms || !st.current) return undefined;
        const target = toSecs(hms);
        const now = this.nowSecs();
        let delta = target - now;
        if (delta < 0) delta = 0; // لا نلفّ لليوم التالي هنا
        const ms = Math.floor(delta * 1000);
        if (DEBUG) {
          const g = group("MS_UNTIL");
          g.log({ target: hms, now: toHHMMSS(now), msUntil: ms });
          g.end();
        }
        return ms;
      },

      /** فرق آخر قياس: |expected - server| بالثواني */
      driftSec(): number {
        return st.current?.lastDriftSec ?? 0;
      },

      /** المنطقة الزمنية آخر مزامنة (معلوماتية) */
      timezone(): string | null {
        return st.current?.tz ?? null;
      },

      /** لوج تفصيلي */
      debugSnapshot() {
        const s = st.current;
        const g = group("SNAPSHOT");
        if (!s) { g.log({ note: "no sync yet" }); g.end(); return; }
        const now = this.nowSecs();
        g.log({
          tz: s.tz,
          baseServer: toHHMMSS(s.baseServerSecs),
          basePerf: s.basePerf.toFixed(1),
          nowHHMMSS: toHHMMSS(now),
          driftSec: s.lastDriftSec,
        });
        g.end();
      },
    };
  }, [tick]);

  return api;
}

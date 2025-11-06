// src/ReactQuery/time/fetchTimeClock.ts
import { TimeClockApi } from "../../Api/Api";

/**
 * يضرب endpoint timeclock ويعيد:
 *  - serverNowMs: لو متاح من JSON
 *  - dateHeaderMs: من Date header (UTC) كـ fallback
 *  - t0/t1: لحساب الأوفست بدقة
 */
export async function fetchTimeClock() {
  const t0 = Date.now();
  const resp = await fetch(TimeClockApi, { method: "GET", cache: "no-store" });
  const t1 = Date.now();

  let json: any = null;
  if (resp.headers.get("content-type")?.includes("application/json")) {
    try { json = await resp.clone().json(); } catch {}
  }

  const serverNowMs: number | undefined =
    typeof json?.serverNowMs === "number" ? json.serverNowMs : undefined;

  const dateHdr = resp.headers.get("date");
  const dateHeaderMs: number | undefined = dateHdr ? Date.parse(dateHdr) : undefined;

  return { t0, t1, serverNowMs, dateHeaderMs, raw: json };
}

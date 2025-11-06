// src/utils/serverClock.ts
type Listener = (offsetMs: number) => void;

let offsetMs = 0;
let lastSyncAt = 0;
const listeners = new Set<Listener>();

export function onClockChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function serverOffsetMs(): number {
  return offsetMs;
}

function _setOffset(newOffset: number) {
  offsetMs = newOffset;
  lastSyncAt = Date.now();
  listeners.forEach((fn) => {
    try { fn(offsetMs); } catch {}
  });
}

/** احسب الأوفست من عينة واحدة: serverMs - ((t0+t1)/2) */
export function calculateOffset(t0: number, serverMs: number, t1: number): number {
  const midpoint = t0 + (t1 - t0) / 2;
  return serverMs - midpoint;
}

/** حدّث الأوفست مباشرة (لو بدك تمرّره من هاندلر خارجي) */
export function setServerOffset(newOffset: number) {
  _setOffset(newOffset);
}

/** آخر مرّة تم فيها المزامنة (ms) */
export function getLastSyncAt(): number {
  return lastSyncAt;
}

/** لو بدك تعرف هل انقضت فترة معيّنة على آخر مزامنة */
export function shouldResync(intervalMs = 5 * 60_000): boolean {
  return Date.now() - lastSyncAt > intervalMs;
}

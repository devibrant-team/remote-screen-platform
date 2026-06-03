// echo.ts
import Echo from "laravel-echo";
import Pusher from "pusher-js";

declare global {
  interface Window {
    Echo: Echo<"reverb">;
    Pusher: typeof Pusher;
  }
}

window.Pusher = Pusher;

export const echo = new Echo({
  broadcaster: "reverb",
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST,
  wsPort: Number(import.meta.env.VITE_REVERB_PORT ?? 80),
  wssPort: Number(import.meta.env.VITE_REVERB_PORT ?? 443),
  forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? "https") === "https",
  enabledTransports: ["ws", "wss"],
});

// ---- Connection status handling ----
type ConnState =
  | "initialized"
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable"
  | "failed";

let currentState: ConnState =
  (echo.connector as any).pusher?.connection?.state ?? "initialized";

const listeners = new Set<(s: ConnState) => void>();

function setState(next: ConnState) {
  currentState = next;
  listeners.forEach((cb) => cb(next));
}

// Under the hood Echo uses pusher-js, so we bind to pusher connection events:
const pusher = (echo.connector as any).pusher;

// All state changes (previous/current)
const handleStateChange = ({
  current,
}: {
  previous: ConnState;
  current: ConnState;
}) => {
  setState(current);
};

pusher.connection.bind(
  "state_change",
  handleStateChange
);

// Specific events you might want to log
const handleConnected = () => console.log("[Reverb] ✅ Connected");
const handleConnecting = () => console.log("[Reverb] ⏳ Connecting...");
const handleDisconnected = () => console.log("[Reverb] ❌ Disconnected");
const handleUnavailable = () => console.log("[Reverb] ⚠ Unavailable");
const handleFailed = () => console.log("[Reverb] 💥 Failed");
const handleConnectionErrorLog = (err: unknown) =>
  console.error("[Reverb] 🚨 Error", err);
const handleConnectionErrorWarn = (err: unknown) => {
  // eslint-disable-next-line no-console
  console.warn("Reverb connection error", err);
};

pusher?.connection.bind("connected", handleConnected);
pusher?.connection.bind("connecting", handleConnecting);
pusher?.connection.bind("disconnected", handleDisconnected);
pusher?.connection.bind("unavailable", handleUnavailable);
pusher?.connection.bind("failed", handleFailed);
pusher?.connection.bind("error", handleConnectionErrorLog);

// Optional error hook
pusher.connection.bind("error", handleConnectionErrorWarn);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pusher?.connection.unbind("state_change", handleStateChange);
    pusher?.connection.unbind("connected", handleConnected);
    pusher?.connection.unbind("connecting", handleConnecting);
    pusher?.connection.unbind("disconnected", handleDisconnected);
    pusher?.connection.unbind("unavailable", handleUnavailable);
    pusher?.connection.unbind("failed", handleFailed);
    pusher?.connection.unbind("error", handleConnectionErrorLog);
    pusher?.connection.unbind("error", handleConnectionErrorWarn);
  });
}

export const ReverbConnection = {
  /** current status string */
  get status(): ConnState {
    return currentState;
  },

  /** boolean */
  isConnected(): boolean {
    return currentState === "connected";
  },

  /** subscribe to status changes; returns an unsubscribe fn */
  onStatus(cb: (s: ConnState) => void): () => void {
    listeners.add(cb);
    // emit current immediately so UI has a value
    cb(currentState);
    return () => listeners.delete(cb);
  },

  /** wait until connected (or timeout) */
  waitUntilConnected(timeoutMs = 10000): Promise<void> {
    if (currentState === "connected") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const off = this.onStatus((s) => {
        if (s === "connected") {
          clearTimeout(t);
          off();
          resolve();
        }
      });
      const t = setTimeout(() => {
        off();
        reject(new Error("Reverb connect timeout"));
      }, timeoutMs);
    });
  },

  /** force reconnect (rarely needed; Echo auto-reconnects) */
  reconnect(): void {
    try {
      pusher.disconnect();
      pusher.connect();
    } catch {
      // noop
    }
  },
};
export function persistAuthTokenFromEvent(payload: any) {
  const token = payload?.token ?? payload?.auth_token;
  if (token) {
    localStorage.setItem("authToken", String(token));
    console.log("[Reverb] ✅ Saved token to localStorage");
  }
}

type Unsub = () => void;

export function subscribeScreenChannel(
  screenId: string | number | null | undefined,
  onScheduleUpdate: (e: any) => void
): Unsub {
  // تحقّق آمن
  if (screenId === null || screenId === undefined || screenId === "") {
    console.warn("[Reverb] ❗ subscribeScreenChannel called without screenId");
    // نرجّع Unsub فارغ حتى لا يكسر التطبيق
    return () => {};
  }

  const idStr = String(screenId);
  const channelName = `screens.${idStr}`;

  console.log(`[Reverb] 🎧 Subscribing to channel: ${channelName}`);
  console.log(`[Reverb] 📺 Screen ID: ${idStr}`);

  const handler = (e: any) => {
    console.log(`[Reverb] 📩 ScheduleUpdate received on ${channelName}`, e);
    console.log(`[Reverb] 🔢 Event belongs to screenId: ${idStr}`);
    persistAuthTokenFromEvent(e);
    onScheduleUpdate(e);
  };

  let channel = echo.channel(channelName);
  channel.listen(".ScheduleUpdate", handler);

  // إعادة الاشتراك عند عودة الاتصال
  const off = ReverbConnection.onStatus((s) => {
    if (s === "connected") {
      console.log(`[Reverb] 🔄 Reconnected — resubscribing to ${channelName}`);
      console.log(`[Reverb] 📺 Screen ID (reconnect): ${idStr}`);
      try {
        channel.stopListening(".ScheduleUpdate", handler);
        echo.leave(channelName);
        channel = echo.channel(channelName);
        channel.listen(".ScheduleUpdate", handler);
        console.log(`[Reverb] ✅ Resubscribed to ${channelName}`);
      } catch (err) {
        console.warn(`[Reverb] ⚠️ Failed to resubscribe to ${channelName}`, err);
      }
    }
  });

  // تنظيف
  return () => {
    console.log(`[Reverb] ❌ Unsubscribing from ${channelName}`);
    console.log(`[Reverb] 📺 Screen ID (cleanup): ${idStr}`);
    try {
      channel.stopListening(".ScheduleUpdate", handler);
      echo.leave(channelName);
    } catch (err) {
      console.warn(`[Reverb] ⚠️ Error while unsubscribing from ${channelName}`, err);
    }
    off();
  };
}
// في echo.ts — اختياري
export function subscribeScreenDeletedChannel(
  screenId: string | number | null | undefined,
  onDeleted: (e: any) => void
): Unsub {
  if (screenId === null || screenId === undefined || screenId === "") {
    console.warn("[Reverb] ❗ subscribeScreenDeletedChannel without screenId");
    return () => {};
  }

  const idStr = String(screenId);
  const channelName = `screens.${idStr}`;

  console.log(`[Reverb] 🎧 Subscribing to ScreenDeleted on: ${channelName}`);

  const handler = (e: any) => {
    console.log(
      `[Reverb] 🧨 ScreenDeleted received on ${channelName}`,
      e
    );
    onDeleted(e);
  };

  let channel = echo.channel(channelName);
  channel.listen(".ScreenDeleted", handler);

  const off = ReverbConnection.onStatus((s) => {
    if (s === "connected") {
      console.log(
        `[Reverb] 🔄 Reconnected — resubscribing ScreenDeleted on ${channelName}`
      );
      try {
        channel.stopListening(".ScreenDeleted", handler);
        echo.leave(channelName);
        channel = echo.channel(channelName);
        channel.listen(".ScreenDeleted", handler);
      } catch (err) {
        console.warn(
          `[Reverb] ⚠ Failed to resubscribe ScreenDeleted on ${channelName}`,
          err
        );
      }
    }
  });

  return () => {
    console.log(
      `[Reverb] ❌ Unsubscribing ScreenDeleted from ${channelName}`
    );
    try {
      channel.stopListening(".ScreenDeleted", handler);
      echo.leave(channelName);
    } catch (err) {
      console.warn(
        `[Reverb] ⚠ Error while unsubscribing ScreenDeleted from ${channelName}`,
        err
      );
    }
    off();
  };
}


// ✅ NEW: ScreenType (portrait/landscape) channel: screenty.{screenCode}
export type ScreenType = "portrait" | "landscape" | string;

function normalizeScreenType(v: any): ScreenType {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return "";
  if (t === "portrait" || t === "p") return "portrait";
  if (t === "landscape" || t === "l") return "landscape";
  return t;
}

export function subscribeScreenTypeChannel(
  screenCode: string | number | null | undefined,
  onType: (type: ScreenType, payload: any) => void
): Unsub {
  if (screenCode === null || screenCode === undefined || screenCode === "") {
    console.warn("[Reverb] ❗ subscribeScreenTypeChannel without screenCode");
    return () => {};
  }

  const codeStr = String(screenCode).trim();
  const channelName = `screenty.${codeStr}`;

  console.log(`[Reverb] 🎧 Subscribing to ScreenType on: ${channelName}`);
  console.log("[Reverb] conn status now:", ReverbConnection.status);

  const handler = (e: any) => {
    const type = normalizeScreenType(e?.type);
    console.log(`[Reverb] 🧭 EVENT on ${channelName}`, e);
    console.log(`[Reverb] 🧭 normalized type:`, type);
    if (type) onType(type, e);
  };

  let channel: any = echo.channel(channelName);
  const onSubscriptionSucceeded = () => {
    console.log(`[Reverb] subscription_succeeded ${channelName}`);
  };
  const onSubscriptionError = (err: any) => {
    console.log(`[Reverb] subscription_error ${channelName}`, err);
  };
  const bindDiagnostics = () => {
    try {
      channel.bind?.("pusher:subscription_succeeded", onSubscriptionSucceeded);
      channel.bind?.("pusher:subscription_error", onSubscriptionError);
    } catch {}
  };
  const unbindDiagnostics = () => {
    try {
      channel.unbind?.("pusher:subscription_succeeded", onSubscriptionSucceeded);
      channel.unbind?.("pusher:subscription_error", onSubscriptionError);
    } catch {}
  };

  // subscription diagnostics
  bindDiagnostics();

  // ✅ listen to multiple names temporarily (until you confirm broadcastAs)
  channel.listen(".ScreenType", handler);
  channel.listen("ScreenType", handler);
  channel.listen("ScreenTypeChanged", handler);

  const off = ReverbConnection.onStatus((s) => {
    if (s === "connected") {
      console.log(
        `[Reverb] 🔄 Reconnected — resubscribing ScreenType on ${channelName}`
      );
      try {
        channel.stopListening(".ScreenType", handler);
        channel.stopListening("ScreenType", handler);
        channel.stopListening("ScreenTypeChanged", handler);
        unbindDiagnostics();
        echo.leave(channelName);

        channel = echo.channel(channelName);

        // re-bind diagnostics
        bindDiagnostics();

        channel.listen(".ScreenType", handler);
        channel.listen("ScreenType", handler);
        channel.listen("ScreenTypeChanged", handler);

        console.log(`[Reverb] ✅ Resubscribed ScreenType on ${channelName}`);
      } catch (err) {
        console.warn(
          `[Reverb] ⚠ Failed to resubscribe ScreenType on ${channelName}`,
          err
        );
      }
    }
  });

  return () => {
    console.log(`[Reverb] ❌ Unsubscribing ScreenType from ${channelName}`);
    try {
      channel.stopListening(".ScreenType", handler);
      channel.stopListening("ScreenType", handler);
      channel.stopListening("ScreenTypeChanged", handler);
      unbindDiagnostics();
      echo.leave(channelName);
    } catch (err) {
      console.warn(
        `[Reverb] ⚠ Error while unsubscribing ScreenType from ${channelName}`,
        err
      );
    }
    off();
  };
}

export function subscribeScreenRefreshChannel(
  screenId: string | number | null | undefined,
  onRefresh: (payload: any) => void
): Unsub {
  if (screenId === null || screenId === undefined || screenId === "") {
    console.warn("[Reverb] subscribeScreenRefreshChannel without screenId");
    return () => {};
  }

  const idStr = String(screenId).trim();
  const channelName = `screenref.${idStr}`;

  console.log(`[Reverb] 🎧 Subscribing ScreenRefresh: ${channelName}`);
  console.log("[Reverb] conn status now:", ReverbConnection.status);

  const handler = (e: any) => {
    console.log(`[Reverb] 🔄 ScreenRefresh on ${channelName}`, e);
    onRefresh(e);
  };

  let ch: any = null;
  let cancelled = false;
  const onSubscriptionSucceeded = () => {
    console.log(`[Reverb] subscription_succeeded ${channelName}`);
  };
  const onSubscriptionError = (err: any) => {
    console.log(`[Reverb] subscription_error ${channelName}`, err);
  };
  const bindDiagnostics = () => {
    try {
      ch?.bind?.("pusher:subscription_succeeded", onSubscriptionSucceeded);
      ch?.bind?.("pusher:subscription_error", onSubscriptionError);
    } catch {}
  };
  const unbindDiagnostics = () => {
    try {
      ch?.unbind?.("pusher:subscription_succeeded", onSubscriptionSucceeded);
      ch?.unbind?.("pusher:subscription_error", onSubscriptionError);
    } catch {}
  };

  (async () => {
    try {
      // ✅ ensures first subscribe happens when socket is ready
      await ReverbConnection.waitUntilConnected(15000);
      if (cancelled) return;

      ch = echo.channel(channelName);

      // diagnostics
      bindDiagnostics();

      // ✅ listen (keep both 1 day; then remove the extra)
      ch.listen(".ScreenRefresh", handler);
      ch.listen("ScreenRefresh", handler);
    } catch (err) {
      console.log(`[Reverb] 💥 ScreenRefresh subscribe failed ${channelName}`, err);
    }
  })();

  // ✅ log reconnect (optional but useful)
  const off = ReverbConnection.onStatus((s) => {
    if (s === "connected") {
      console.log(`[Reverb] 🔄 Reconnected — ScreenRefresh still on ${channelName}`);
    }
  });

  return () => {
    cancelled = true;
    console.log(`[Reverb] ❌ Unsub ScreenRefresh: ${channelName}`);
    try {
      ch?.stopListening?.(".ScreenRefresh", handler);
      ch?.stopListening?.("ScreenRefresh", handler);
      unbindDiagnostics();
    } catch {}
    try {
      echo.leave(channelName);
    } catch {}
    off();
  };
}

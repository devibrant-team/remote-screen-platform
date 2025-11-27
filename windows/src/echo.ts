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
pusher.connection.bind(
  "state_change",
  ({ current }: { previous: ConnState; current: ConnState }) => {
    setState(current);
  }
);

// Specific events you might want to log
pusher?.connection.bind("connected", () =>
  console.log("[Reverb] ✅ Connected")
);
pusher?.connection.bind("connecting", () =>
  console.log("[Reverb] ⏳ Connecting...")
);
pusher?.connection.bind("disconnected", () =>
  console.log("[Reverb] ❌ Disconnected")
);
pusher?.connection.bind("unavailable", () =>
  console.log("[Reverb] ⚠ Unavailable")
);
pusher?.connection.bind("failed", () => console.log("[Reverb] 💥 Failed"));
pusher?.connection.bind("error", (err: unknown) =>
  console.error("[Reverb] 🚨 Error", err)
);

// Optional error hook
pusher.connection.bind("error", (err: unknown) => {
  // eslint-disable-next-line no-console
  console.warn("Reverb connection error", err);
});

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

  const channel = echo.channel(channelName);
  channel.listen(".ScheduleUpdate", handler);

  // إعادة الاشتراك عند عودة الاتصال
  const off = ReverbConnection.onStatus((s) => {
    if (s === "connected") {
      console.log(`[Reverb] 🔄 Reconnected — resubscribing to ${channelName}`);
      console.log(`[Reverb] 📺 Screen ID (reconnect): ${idStr}`);
      try {
        echo.leave(channelName);
        const c = echo.channel(channelName);
        c.listen(".ScheduleUpdate", handler);
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

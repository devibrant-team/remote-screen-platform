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
pusher?.connection.bind('connected', () => console.log('[Reverb] ✅ Connected'));
pusher?.connection.bind('connecting', () => console.log('[Reverb] ⏳ Connecting...'));
pusher?.connection.bind('disconnected', () => console.log('[Reverb] ❌ Disconnected'));
pusher?.connection.bind('unavailable', () => console.log('[Reverb] ⚠ Unavailable'));
pusher?.connection.bind('failed', () => console.log('[Reverb] 💥 Failed'));
pusher?.connection.bind('error', (err: unknown) => console.error('[Reverb] 🚨 Error', err));


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

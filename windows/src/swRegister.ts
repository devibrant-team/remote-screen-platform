// src/swRegister.ts
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // eslint-disable-next-line no-console
        console.log("[SW] registered:", reg.scope);

        // اختياري: استمع للتحديث
        if (reg.waiting) {
          // eslint-disable-next-line no-console
          console.log("[SW] waiting update available");
        }
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            // eslint-disable-next-line no-console
            console.log("[SW] state:", nw.state);
          });
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[SW] register failed:", err);
      });
  });
}

// src/swRegister.ts

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[SW] ✓ Registered:", reg.scope);

        if (reg.waiting) {
          console.log("[SW] Update available (waiting)");
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          console.log("[SW] Update found…");

          newWorker.addEventListener("statechange", () => {
            console.log("[SW] State:", newWorker.state);

            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              console.log("[SW] New version installed and ready ✔");
              window.dispatchEvent(new Event("sw:update-ready"));
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          console.log("[SW] Controller changed → new version active");
        });
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
  });
}

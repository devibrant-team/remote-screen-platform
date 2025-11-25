import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

import { Provider } from "react-redux";
import { store } from "../store";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { registerServiceWorker } from "./swRegister";

const storedName = localStorage.getItem("screenName");
document.title = storedName || "Windows Screen Iguana";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </Provider>
  </StrictMode>
);

// تسجيل الـ Service Worker
registerServiceWorker();

// لو حاب تعمل auto-reload عند وجود update:
window.addEventListener("sw:update-ready", () => {
  console.log("[SW] Reloading to activate new version…");
  window.location.reload();
});

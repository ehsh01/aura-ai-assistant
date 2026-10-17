import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { normalizeBrowserPath } from "./lib/app-path";
import { startServiceWorkerUpdateCoordinator } from "./lib/service-worker-update";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

normalizeBrowserPath();

startServiceWorkerUpdateCoordinator({
  currentBuildId: __RECALL_BUILD_ID__,
  buildMetadataUrl: new URL(
    `${import.meta.env.BASE_URL}build.json`,
    window.location.origin,
  ).toString(),
});

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply updates immediately so Home/Ask tweaks aren't stuck behind a stale PWA cache.
    void updateSW(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      void registration.update().catch(() => {});
    };
    window.setTimeout(() => {
      checkForUpdate();
    }, 5_000);
    window.setInterval(checkForUpdate, 30 * 60 * 1_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});

createRoot(document.getElementById("root")!).render(<App />);

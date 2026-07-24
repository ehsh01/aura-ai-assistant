import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { normalizeBrowserPath } from "./lib/app-path";
import "./index.css";

normalizeBrowserPath();

// Bump when Ask chrome changes so stale PWAs pick up the new bundle faster.
const RECALL_UI_BUILD = "ask-compact-2026-07-24b";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply updates immediately so Home/Ask tweaks aren't stuck behind a stale PWA cache.
    void updateSW(true);
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    // Check for a new SW shortly after load (covers tabs left open across deploys).
    window.setTimeout(() => {
      void registration.update();
    }, 5_000);
  },
});

try {
  if (typeof sessionStorage !== "undefined") {
    const prev = sessionStorage.getItem("recall-ui-build");
    if (prev && prev !== RECALL_UI_BUILD) {
      void updateSW(true);
    }
    sessionStorage.setItem("recall-ui-build", RECALL_UI_BUILD);
  }
} catch {
  // Ignore private-mode / blocked storage.
}

createRoot(document.getElementById("root")!).render(<App />);

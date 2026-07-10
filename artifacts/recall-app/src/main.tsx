import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { normalizeBrowserPath } from "./lib/app-path";
import "./index.css";

normalizeBrowserPath();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Apply updates immediately so Home backdrop tweaks aren't stuck behind a stale PWA cache.
    void updateSW(true);
  },
});

createRoot(document.getElementById("root")!).render(<App />);

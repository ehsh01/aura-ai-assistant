import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { normalizeBrowserPath } from "./lib/app-path";
import "./index.css";

normalizeBrowserPath();

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);

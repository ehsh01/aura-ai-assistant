import { createRoot } from "react-dom/client";
import App from "./App";
import { normalizeBrowserPath } from "./lib/app-path";
import "./index.css";

normalizeBrowserPath();

createRoot(document.getElementById("root")!).render(<App />);

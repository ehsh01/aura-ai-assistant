import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { normalizeBrowserPath } from "./lib/app-path";
import "./index.css";

normalizeBrowserPath();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast({
      title: "Update available",
      description: "A newer version of Recall is ready.",
      duration: 120_000,
      action: (
        <ToastAction
          altText="Reload to update"
          onClick={() => {
            void updateSW(true);
          }}
        >
          Reload
        </ToastAction>
      ),
    });
  },
});

createRoot(document.getElementById("root")!).render(<App />);

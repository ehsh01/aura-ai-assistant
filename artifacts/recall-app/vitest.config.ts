import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests do not require the PWA plugin or
// the PORT/BASE_PATH env vars that the app build enforces.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

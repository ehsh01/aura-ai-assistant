import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "iphone-webkit",
      use: {
        ...devices["iPhone 13"],
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/auth-fixture-server.mjs",
      url: "http://127.0.0.1:5008/api/healthz",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        "PORT=4173 BASE_PATH=/ pnpm exec vite --config vite.config.ts --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

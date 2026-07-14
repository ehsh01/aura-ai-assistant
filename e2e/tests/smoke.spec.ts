import { expect, test } from "@playwright/test";

/**
 * Smoke suite — production-safe, no auth required.
 * Override target with E2E_BASE_URL=http://127.0.0.1:5173
 */
test.describe("Recall smoke", () => {
  test("API healthz is ok", async ({ request, baseURL }) => {
    const origin = (baseURL || "https://recall-app.net").replace(/\/$/, "");
    const res = await request.get(`${origin}/api/healthz`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("API ready endpoint responds", async ({ request, baseURL }) => {
    const origin = (baseURL || "https://recall-app.net").replace(/\/$/, "");
    const res = await request.get(`${origin}/api/ready`);
    // Ready may be 200 or 503 depending on DB; must return JSON status.
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });

  test("marketing / app shell loads", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
    const title = await page.title();
    expect(title.toLowerCase()).toMatch(/recall/);
  });
});

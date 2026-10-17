import { expect, test } from "@playwright/test";

const sessionCookie = "pwa-session";

test("standalone iPhone sign-in persists its session after reload", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
  });

  await page.goto("/login");

  const form = page.locator("form");
  await expect(form).toHaveAttribute("action", "/api/auth/login-form");
  await expect(form).toHaveAttribute("method", "post");

  await page.locator('input[type="email"]').fill("pwa@example.com");
  await page.locator('input[type="password"]').fill("correct-password");
  const signedIn = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/me") && response.status() === 200,
  );
  await form.getByRole("button", { name: "Sign in" }).click();
  await signedIn;

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "Today",
      }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.find((cookie) => cookie.name === "recall_session");
    })
    .toMatchObject({ value: sessionCookie, httpOnly: true });

  const reloadedSession = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/me") && response.status() === 200,
  );
  await page.reload();
  await reloadedSession;

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});

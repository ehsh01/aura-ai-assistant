import { describe, expect, it } from "vitest";
import {
  buildHomeyAuthUrl,
  homeyConnector,
  isHomeyOAuthConfigured,
  isRiskyHomeyCapability,
  normalizeHomeyAlert,
  normalizeHomeyLastUpdated,
  normalizeSeverity,
  openHomeyApiSession,
  verifyHomeyWebhookSecret,
} from "./homey";

describe("homey connector helpers", () => {
  it("reports OAuth misconfiguration when env unset", () => {
    const prevId = process.env.HOMEY_CLIENT_ID;
    const prevSecret = process.env.HOMEY_CLIENT_SECRET;
    delete process.env.HOMEY_CLIENT_ID;
    delete process.env.HOMEY_CLIENT_SECRET;
    expect(isHomeyOAuthConfigured()).toBe(false);
    if (prevId) process.env.HOMEY_CLIENT_ID = prevId;
    if (prevSecret) process.env.HOMEY_CLIENT_SECRET = prevSecret;
  });

  it("builds authorize URL with response_type=code", () => {
    const prevId = process.env.HOMEY_CLIENT_ID;
    const prevSecret = process.env.HOMEY_CLIENT_SECRET;
    process.env.HOMEY_CLIENT_ID = "client-test";
    process.env.HOMEY_CLIENT_SECRET = "secret-test";
    const url = new URL(buildHomeyAuthUrl("state-1"));
    expect(url.origin + url.pathname).toBe("https://api.athom.com/oauth2/authorise");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-test");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.has("authorization_type")).toBe(false);
    if (prevId) process.env.HOMEY_CLIENT_ID = prevId;
    else delete process.env.HOMEY_CLIENT_ID;
    if (prevSecret) process.env.HOMEY_CLIENT_SECRET = prevSecret;
    else delete process.env.HOMEY_CLIENT_SECRET;
  });

  it("accepts Athom delegation tokens returned as JSON strings", async () => {
    const prevFetch = globalThis.fetch;
    try {
      let calls = 0;
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls += 1;
        const url = String(input);
        if (url.includes("/delegation/token")) {
          return new Response(JSON.stringify("deleg-jwt"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/manager/users/login")) {
          return new Response(JSON.stringify("session-token"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("unexpected", { status: 500 });
      }) as typeof fetch;

      const session = await openHomeyApiSession({
        accessToken: "cloud-token",
        remoteUrl: "https://example.homeypro.net",
        homeyId: "h1",
      });
      expect(session.sessionToken).toBe("session-token");
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("normalizes severity aliases", () => {
    expect(normalizeSeverity("critical")).toBe("emergency");
    expect(normalizeSeverity("low")).toBe("info");
    expect(normalizeSeverity(null)).toBe("warn");
  });

  it("flags risky capabilities", () => {
    expect(isRiskyHomeyCapability("locked")).toBe(true);
    expect(isRiskyHomeyCapability("garagedoor_closed")).toBe(true);
    expect(isRiskyHomeyCapability("onoff")).toBe(false);
  });

  it("verifies webhook secrets", () => {
    const secret = "hwk_testsecret";
    expect(verifyHomeyWebhookSecret(secret, secret)).toBe(true);
    expect(verifyHomeyWebhookSecret("wrong", secret)).toBe(false);
    expect(verifyHomeyWebhookSecret(null, secret)).toBe(false);
  });

  it("normalizes Homey lastUpdated timestamps", () => {
    expect(normalizeHomeyLastUpdated("2026-07-15T16:14:03.000Z")).toBe(
      "2026-07-15T16:14:03.000Z",
    );
    expect(normalizeHomeyLastUpdated(1_721_070_843_000)).toBe(
      new Date(1_721_070_843_000).toISOString(),
    );
    expect(normalizeHomeyLastUpdated(null)).toBeNull();
  });

  it("preserves occurredAt on alerts", () => {
    const alert = normalizeHomeyAlert(
      {
        title: "Front door opened",
        severity: "info",
        kind: "door_opened",
        deviceName: "Front door",
        occurredAt: "2026-07-15T16:14:03.000Z",
      },
      { connectorId: "conn-1" },
    );
    expect(alert.sourceCreatedAt).toBe("2026-07-15T16:14:03.000Z");
    expect(alert.metadata?.occurredAt).toBe("2026-07-15T16:14:03.000Z");
    expect(alert.recordText).toContain("occurredAt: 2026-07-15T16:14:03.000Z");
  });

  it("normalizes alert + device bundle records", async () => {
    const alert = normalizeHomeyAlert(
      {
        title: "Leak",
        severity: "emergency",
        kind: "leak",
        deviceName: "Laundry",
      },
      { connectorId: "conn-1" },
    );
    expect(alert.recordType).toBe("homey_alert");
    expect(alert.metadata?.severity).toBe("emergency");

    const rows = await homeyConnector.normalize([
      {
        externalId: "dev-1",
        recordType: "homey_device",
        recordTitle: "Porch Light",
        recordText: "homey device",
        metadata: { zoneName: "Outside" },
      },
      alert,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.recordType).toBe("homey_device");
    expect(rows[1]?.recordMetadata?.severity).toBe("emergency");
    expect(homeyConnector.mapEvidence(rows[1]!).length).toBe(1);
  });
});

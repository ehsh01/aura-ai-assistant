import { describe, expect, it } from "vitest";
import { isMicrosoftOAuthConfigured, microsoftConnector } from "./microsoft";

describe("microsoftConnector", () => {
  it("reports OAuth misconfiguration when env unset", () => {
    const prevId = process.env.MICROSOFT_CLIENT_ID;
    const prevSecret = process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(isMicrosoftOAuthConfigured()).toBe(false);
    if (prevId) process.env.MICROSOFT_CLIENT_ID = prevId;
    if (prevSecret) process.env.MICROSOFT_CLIENT_SECRET = prevSecret;
  });

  it("normalizes outlook and teams records", async () => {
    const rows = await microsoftConnector.normalize([
      {
        externalId: "outlook-1",
        recordType: "outlook_message",
        recordTitle: "Budget review",
        recordText: "From: Ada <ada@example.com>\nPlease review Q3.",
        sourceUrl: "https://outlook.office.com/mail/id/1",
        sourceCreatedAt: "2026-07-01T10:00:00.000Z",
      },
      {
        externalId: "teams-1",
        recordType: "teams_chat_message",
        recordTitle: "Ops chat",
        recordText: "From: Ada\nCan we sync tomorrow?",
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.recordType).toBe("outlook_message");
    expect(microsoftConnector.mapEvidence(rows[0]!).length).toBe(1);
  });
});

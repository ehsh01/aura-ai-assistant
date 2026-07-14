import { describe, expect, it } from "vitest";
import { parseTicketEmailFields, ticketEmailConnector } from "./ticket-email";

describe("parseTicketEmailFields", () => {
  it("extracts ticket number, priority, and link", () => {
    const parsed = parseTicketEmailFields(
      "[INC-1042] VPN access for new hire",
      "Priority: High\nRequester: Jordan Lee\nhttps://tickets.example.com/INC-1042\n\nPlease provision VPN for start Monday.",
      "Helpdesk <help@example.com>",
    );
    expect(parsed.ticketNumber).toMatch(/INC-1042/i);
    expect(parsed.priority?.toLowerCase()).toBe("high");
    expect(parsed.ticketLink).toContain("tickets.example.com");
    expect(parsed.requester).toMatch(/Jordan Lee|help@example.com/);
    expect(parsed.title).toMatch(/VPN access/i);
  });
});

describe("ticketEmailConnector.normalize", () => {
  it("builds a searchable source record", async () => {
    const [row] = await ticketEmailConnector.normalize([
      {
        externalId: "imap-INBOX-1",
        subject: "Ticket #8821 Printer offline",
        from: "ops@example.com",
        bodyText: "Priority: Medium\nFloor 3 printer is offline since noon.",
        receivedAt: "2026-07-01T12:00:00.000Z",
      },
    ]);
    expect(row?.recordType).toBe("ticket_email");
    expect(row?.recordText).toMatch(/Ticket:/);
    expect(row?.recordTitle).toMatch(/Printer/i);
  });
});

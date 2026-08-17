import { describe, expect, it } from "vitest";
import { shouldNotify } from "./notification-policy";

describe("shouldNotify", () => {
  it("allows existing reminder behavior by default", () => {
    expect(shouldNotify({ kind: "reminder", inQuietHours: true, confidence: 0.9 }).allow).toBe(true);
  });

  it("never notifies uncertain items", () => {
    expect(shouldNotify({ kind: "uncertain", inQuietHours: false, confidence: 0.2 }).allow).toBe(
      false,
    );
  });

  it("always allows a user-initiated inbound reply", () => {
    expect(
      shouldNotify({ kind: "inbound_reply", inQuietHours: true, userInitiated: true }).allow,
    ).toBe(true);
  });

  it("blocks briefing during quiet hours", () => {
    expect(shouldNotify({ kind: "briefing", inQuietHours: true }).reason).toBe("quiet_hours");
  });
});

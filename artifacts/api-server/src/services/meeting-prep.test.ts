import { describe, expect, it } from "vitest";
import { buildMeetingPrep } from "./meeting-prep";

describe("buildMeetingPrep", () => {
  it("links a calendar title to a known person and waiting item", () => {
    const items = buildMeetingPrep({
      calendarToday: [
        {
          id: "evt-1",
          title: "Call Carlos about inspection",
          startLabel: "2:00 PM",
          location: null,
          href: "/deadlines?item=a1",
        },
      ],
      people: [{ id: "p1", displayName: "Carlos Mendez" }],
      waiting: [
        { ownerName: "Carlos", ownerPersonId: "p1", deliverable: "Inspection confirmation" },
      ],
    });
    expect(items[0]?.personName).toBe("Carlos Mendez");
    expect(items[0]?.waitingCount).toBe(1);
    expect(items[0]?.recentContext).toMatch(/Inspection confirmation/);
  });

  it("does not invent attendees", () => {
    const items = buildMeetingPrep({
      calendarToday: [
        { id: "evt-2", title: "Focus block", startLabel: "9:00 AM", location: null, href: "/today" },
      ],
      people: [{ id: "p1", displayName: "Carlos Mendez" }],
      waiting: [],
    });
    expect(items[0]?.personName).toBeNull();
    expect(items[0]?.waitingCount).toBe(0);
  });
});

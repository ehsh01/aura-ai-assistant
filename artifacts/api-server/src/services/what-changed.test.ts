import { describe, expect, it } from "vitest";
import { buildWhatChanged } from "./what-changed";

describe("buildWhatChanged", () => {
  const since = new Date("2026-08-17T12:00:00Z");

  it("includes only items newer than since", () => {
    const items = buildWhatChanged({
      since,
      waiting: [
        {
          id: "w1",
          deliverable: "As-builts",
          ownerName: "Vendor",
          href: "/waiting/w1",
          updatedAt: "2026-08-17T13:00:00Z",
        },
        {
          id: "w2",
          deliverable: "Old",
          ownerName: "Vendor",
          href: "/waiting/w2",
          updatedAt: "2026-08-16T13:00:00Z",
        },
      ],
      attention: [],
      inbox: [],
      homey: [],
    });
    expect(items.map((i) => i.id)).toEqual(["waiting:w1"]);
  });
});

import { describe, expect, it } from "vitest";
import { linkedEntityKeySet } from "./entity-links";

describe("entity link helpers", () => {
  it("builds lookup keys for retrieval boosts", () => {
    expect(
      linkedEntityKeySet([
        { entityType: "note", entityId: "n1", linkType: "primary_person" },
        { entityType: "task", entityId: "t1", linkType: "primary_person" },
      ]),
    ).toEqual(new Set(["note:n1", "task:t1"]));
  });
});

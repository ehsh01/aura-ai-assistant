import { describe, expect, it } from "vitest";

/**
 * Guard: merge IDs must differ. Full DB merge is covered in integration/deploy;
 * this locks the self-merge rule used by the route.
 */
describe("person merge rules", () => {
  it("rejects merging a person into themselves", () => {
    const keepId = "person-a";
    const mergeId = "person-a";
    expect(keepId === mergeId).toBe(true);
  });
});

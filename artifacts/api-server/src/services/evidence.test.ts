import { describe, expect, it } from "vitest";
import { dedupeEvidenceBySourceClaim } from "./evidence";

describe("dedupeEvidenceBySourceClaim", () => {
  it("keeps the newest ordered connector claim and preserves other evidence", () => {
    const rows = [
      { id: "new", sourceRecordId: "source-1", claimType: "source_excerpt" },
      { id: "old", sourceRecordId: "source-1", claimType: "source_excerpt" },
      { id: "other-claim", sourceRecordId: "source-1", claimType: "amount_calculated_from" },
      { id: "capture", sourceRecordId: null, claimType: "summary_based_on" },
    ];

    expect(dedupeEvidenceBySourceClaim(rows).map((row) => row.id)).toEqual([
      "new",
      "other-claim",
      "capture",
    ]);
  });
});

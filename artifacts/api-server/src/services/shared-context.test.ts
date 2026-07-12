import { describe, expect, it } from "vitest";
import {
  groupLinkedEntityIds,
  mergeSharedContextIntoCorpus,
} from "./shared-context";

describe("shared context helpers", () => {
  it("merges linked records that are missing from the corpus", () => {
    const corpus = [
      { entityType: "note", entityId: "n1", title: "Recent", text: "a" },
    ];
    const linked = [
      { entityType: "note", entityId: "n1", title: "Recent", text: "a" },
      { entityType: "note", entityId: "n-old", title: "Old VIN", text: "WP0" },
      { entityType: "memory", entityId: "m1", title: "Wife", text: "Sandra" },
    ];
    const merged = mergeSharedContextIntoCorpus(corpus, linked);
    expect(merged.map((r) => r.entityId)).toEqual(["n1", "n-old", "m1"]);
  });

  it("groups linked entity ids by type", () => {
    expect(
      groupLinkedEntityIds([
        { entityType: "note", entityId: "n1", linkType: "primary_person" },
        { entityType: "note", entityId: "n2", linkType: "primary_person" },
        { entityType: "note", entityId: "n1", linkType: "primary_person" },
        { entityType: "task", entityId: "t1", linkType: "primary_person" },
      ]),
    ).toEqual({
      note: ["n1", "n2"],
      task: ["t1"],
    });
  });
});

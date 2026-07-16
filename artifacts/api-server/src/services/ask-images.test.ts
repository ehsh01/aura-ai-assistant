import { describe, expect, it } from "vitest";
import { noteIdsForAskImages, wantsShowSavedImage } from "./ask-images";

describe("wantsShowSavedImage", () => {
  it("matches show-me-the-picture phrasing", () => {
    expect(wantsShowSavedImage("show me the registration picture")).toBe(true);
    expect(wantsShowSavedImage("Can you display the photo of my title?")).toBe(true);
    expect(wantsShowSavedImage("open the scan of the warranty")).toBe(true);
    expect(wantsShowSavedImage("show my registration photo")).toBe(true);
  });

  it("does not match text-only fact questions", () => {
    expect(wantsShowSavedImage("what is the VIN on my registration?")).toBe(false);
    expect(wantsShowSavedImage("when does my registration expire?")).toBe(false);
  });
});

describe("noteIdsForAskImages", () => {
  it("keeps ranked note order and skips non-notes", () => {
    expect(
      noteIdsForAskImages([
        { entityType: "task", entityId: "t1" },
        { entityType: "note", entityId: "n1" },
        { entityType: "note", entityId: "n1" },
        { entityType: "note", entityId: "n2" },
      ]),
    ).toEqual(["n1", "n2"]);
  });
});

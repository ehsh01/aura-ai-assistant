import { describe, expect, it } from "vitest";
import { compileCorrectionRule } from "./correction-rules";

describe("compileCorrectionRule", () => {
  it("turns a person rename into a rule", () => {
    expect(
      compileCorrectionRule({
        entityType: "person",
        fieldName: "displayName",
        oldValue: "John",
        newValue: "John Carter",
      }),
    ).toBe('When I say "John", I mean John Carter.');
  });

  it("ignores low-signal edits", () => {
    expect(
      compileCorrectionRule({
        entityType: "person",
        fieldName: "notes",
        oldValue: "a",
        newValue: "b",
      }),
    ).toBeNull();
  });

  it("records dismissed captures when there is a type", () => {
    expect(
      compileCorrectionRule({
        entityType: "capture_item",
        fieldName: "status",
        oldValue: "newsletter",
        newValue: "dismissed",
      }),
    ).toMatch(/low priority/);
  });
});

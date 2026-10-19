import { describe, expect, it } from "vitest";
import { graphTooltipText, maskGraphDisplayText } from "./graph-privacy";

describe("graph privacy display", () => {
  it("masks only digit runs of at least five characters", () => {
    expect(maskGraphDisplayText("3 links · 2026 · 12345 · 12345678")).toBe(
      "3 links · 2026 · ****2345 · ****5678",
    );
    expect(maskGraphDisplayText("Account ****5678")).toBe("Account ****5678");
  });

  it("never masks the tooltip link count", () => {
    expect(graphTooltipText("Account 12345678", 3)).toBe(
      "Account ****5678 · 3 links",
    );
  });
});

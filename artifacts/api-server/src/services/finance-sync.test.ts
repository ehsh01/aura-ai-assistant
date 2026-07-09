import { describe, expect, it } from "vitest";
import { extractPayeeHint } from "./finance-sync";

describe("extractPayeeHint", () => {
  it("pulls merchant after 'at'", () => {
    expect(extractPayeeHint("How much did I spend at Publix last month?")).toBe("Publix");
  });

  it("pulls merchant after 'spent at'", () => {
    expect(extractPayeeHint("What did I spend at Shell this week")).toBe("Shell");
  });

  it("returns null when no merchant is present", () => {
    expect(extractPayeeHint("How much did I spend this month?")).toBeNull();
  });
});

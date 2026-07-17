import { describe, expect, it } from "vitest";
import { USER_RULES_PROMPT_CAP } from "./user-rules";

describe("user rules prompt cap", () => {
  it("keeps a sensible character budget for Ask injection", () => {
    expect(USER_RULES_PROMPT_CAP).toBeGreaterThanOrEqual(400);
    expect(USER_RULES_PROMPT_CAP).toBeLessThanOrEqual(4000);
  });
});

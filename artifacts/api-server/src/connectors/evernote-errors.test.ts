import { describe, expect, it } from "vitest";
import { evernoteMcpFailureReason } from "./evernote-errors";

describe("Evernote MCP connect failures", () => {
  it("maps plan eligibility rejection to actionable UI reason", () => {
    expect(
      evernoteMcpFailureReason(
        new Error("This account is not eligible; upgrade to a paid plan"),
      ),
    ).toBe("plan_required");
  });

  it("keeps unrelated OAuth failures generic", () => {
    expect(evernoteMcpFailureReason(new Error("invalid state"))).toBe(
      "oauth_failed",
    );
  });
});

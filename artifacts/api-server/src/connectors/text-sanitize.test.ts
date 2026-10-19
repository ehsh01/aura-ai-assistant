import { describe, expect, it } from "vitest";
import {
  sanitizeConnectorJson,
  sanitizeUnicodeText,
} from "./text-sanitize";

describe("connector text sanitization", () => {
  it("replaces lone high and low surrogates while preserving valid emoji", () => {
    expect(sanitizeUnicodeText("before\ud83dafter")).toBe(
      "before\ufffdafter",
    );
    expect(sanitizeUnicodeText("before\udc00after")).toBe(
      "before\ufffdafter",
    );
    expect(sanitizeUnicodeText("valid \ud83d\ude00")).toBe("valid 😀");
  });

  it("sanitizes nested JSON keys and values", () => {
    expect(
      sanitizeConnectorJson({
        "bad\ud83d": ["subject\ud83d", { header: "\udc00name" }],
      }),
    ).toEqual({
      "bad\ufffd": ["subject\ufffd", { header: "\ufffdname" }],
    });
  });
});

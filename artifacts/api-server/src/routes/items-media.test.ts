import { describe, expect, it } from "vitest";
import { isSafeInlineMediaType } from "./items";

describe("owner document inline media policy", () => {
  it.each([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain; charset=utf-8",
  ])("allows inert browser previews for %s", (mimeType) => {
    expect(isSafeInlineMediaType(mimeType)).toBe(true);
  });

  it.each([
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "application/xhtml+xml",
  ])("forces active content to download for %s", (mimeType) => {
    expect(isSafeInlineMediaType(mimeType)).toBe(false);
  });
});

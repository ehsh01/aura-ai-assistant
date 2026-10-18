import { describe, expect, it } from "vitest";
import {
  extractRealHttpUrls,
  isPlaceholderUrl,
  PLACEHOLDER_URL_RULES,
} from "./url-quality";

describe("placeholder URL classification", () => {
  it.each([
    "https://example.com/path",
    "https://docs.example.org/help",
    "http://example.net",
    "http://the-actual-link-here.com",
    "http://localhost:3000/page",
    "http://127.0.0.1:8080/page",
    "https://yourdomain.com/path",
    "https://your-site.org",
    "https://yoursite.net",
    "https://real-looking.org/placeholder/link",
    "https://real-looking.org/the-actual-link-here",
    "https://yourwebsite.co/path",
    "https://replace-me.invalid/page",
    "https://service.test/path",
  ])("rejects obvious template URL %s", (url) => {
    expect(isPlaceholderUrl(url)).toBe(true);
  });

  it("keeps the placeholder rules centralized", () => {
    expect(PLACEHOLDER_URL_RULES.exactHosts).toContain("example.com");
    expect(PLACEHOLDER_URL_RULES.hostFragments).toContain(
      "the-actual-link-here",
    );
    expect(PLACEHOLDER_URL_RULES.urlFragments).toContain("placeholder");
  });

  it("keeps real links and preserves their source order", () => {
    expect(
      extractRealHttpUrls(
        "Template http://the-actual-link-here.com then https://umiamihealth.org/treatments/psychiatry and https://uhealthsystem.com/locations.",
      ),
    ).toEqual([
      "https://umiamihealth.org/treatments/psychiatry",
      "https://uhealthsystem.com/locations",
    ]);
  });
});

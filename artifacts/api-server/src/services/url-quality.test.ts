import { describe, expect, it } from "vitest";
import {
  extractLinkCandidates,
  extractRealHttpUrls,
  isPlaceholderUrl,
  isTrackingOrUtilityUrl,
  URL_REJECTION_RULES,
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
    expect(URL_REJECTION_RULES.exactHosts).toContain("example.com");
    expect(URL_REJECTION_RULES.hostFragments).toContain(
      "the-actual-link-here",
    );
    expect(URL_REJECTION_RULES.urlFragments).toContain("placeholder");
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

  it("recognizes and normalizes bare domains without extracting email domains", () => {
    expect(
      extractLinkCandidates(
        "Use psychiatry.med.miami.edu or www.uhealthsystem.org. Email help@example.org.",
      ).map((candidate) => candidate.url),
    ).toEqual([
      "https://psychiatry.med.miami.edu",
      "https://www.uhealthsystem.org",
    ]);
  });

  it.each([
    "https://trk.policyemail.bestbuy.com/click/sale",
    "https://click.vendor.com/path",
    "https://company.list-manage.com/track/click",
    "https://api.sendgrid.com/redirect",
    "https://real-domain.com/unsubscribe?id=1",
    "https://real-domain.com/?utm_source=email&utm_campaign=sale",
  ])("rejects tracking, redirect, or unsubscribe URL %s", (url) => {
    expect(isTrackingOrUtilityUrl(url)).toBe(true);
  });

  it("skips maps unless the question asks for location", () => {
    const map = "https://maps.google.com/?q=UHealth+Psychiatry";
    expect(isTrackingOrUtilityUrl(map)).toBe(true);
    expect(isTrackingOrUtilityUrl(map, { allowMaps: true })).toBe(false);
  });
});

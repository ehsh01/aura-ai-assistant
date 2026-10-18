import { describe, expect, it } from "vitest";
import {
  extractLinkCandidates,
  extractRealHttpUrls,
  isPlaceholderUrl,
  isTrackingOrUtilityUrl,
  unwrapRedirectUrl,
  urlSelectionPenalty,
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
    "https://pdf-name.pdf",
    "https://c.riveron",
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

  it("rejects file-like and email fragments while preserving real bare domains", () => {
    expect(
      extractLinkCandidates(
        "/documents/pdf-name.pdf mailto:c.riveron@med.miami.edu c.riveron@med.miami.edu psychiatry.med.miami.edu service.gov.uk",
      ).map((candidate) => candidate.url),
    ).toEqual([
      "https://psychiatry.med.miami.edu",
      "https://service.gov.uk",
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

  it.each([
    [
      "https://nam10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fsecure.touchnet.net%2Fcentral&data=abc",
      "https://secure.touchnet.net/central",
    ],
    [
      "https://www.google.com/url?q=https%3A%2F%2Fsmartersoftware.io%2F&sa=D",
      "https://smartersoftware.io/",
    ],
  ])("unwraps redirect wrapper %s", (wrapper, target) => {
    expect(unwrapRedirectUrl(wrapper)).toBe(target);
    expect(extractLinkCandidates(wrapper)[0]?.url).toBe(target);
  });

  it("down-ranks consoles, query-heavy apps, and checkout URLs for website asks", () => {
    expect(
      urlSelectionPenalty(
        "https://cloud.digitalocean.com/spaces/psychiatry-inventory?i=abc",
        { websiteAsk: true },
      ),
    ).toBeGreaterThan(150);
    expect(
      urlSelectionPenalty("https://build.com/checkout/order?id=1", {
        websiteAsk: true,
      }),
    ).toBeGreaterThan(100);
    expect(
      urlSelectionPenalty("https://psychiatry.med.miami.edu", {
        websiteAsk: true,
      }),
    ).toBe(0);
    expect(
      urlSelectionPenalty("https://dashboard.vendor.com/app?id=1", {
        websiteAsk: true,
      }),
    ).toBeGreaterThan(150);
    expect(
      urlSelectionPenalty("https://tenant.amazonaws.com/console?id=1", {
        websiteAsk: true,
      }),
    ).toBeGreaterThan(100);
    expect(
      urlSelectionPenalty("https://portal.vendor.com/portal/admin?id=1", {
        websiteAsk: true,
      }),
    ).toBeGreaterThan(100);
  });
});

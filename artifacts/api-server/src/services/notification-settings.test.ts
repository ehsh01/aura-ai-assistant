import { describe, expect, it } from "vitest";
import {
  clampLeadMinutes,
  formatPhoneNumberForDisplay,
  normalizePhoneNumberE164,
} from "./notification-settings";

describe("normalizePhoneNumberE164", () => {
  it("adds +1 to a bare 10-digit US number", () => {
    expect(normalizePhoneNumberE164("5551234567")).toBe("+15551234567");
  });

  it("accepts common punctuation formats", () => {
    expect(normalizePhoneNumberE164("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhoneNumberE164("555.123.4567")).toBe("+15551234567");
  });

  it("accepts an 11-digit number with a leading country code", () => {
    expect(normalizePhoneNumberE164("15551234567")).toBe("+15551234567");
  });

  it("passes through an already-E.164 number", () => {
    expect(normalizePhoneNumberE164("+15551234567")).toBe("+15551234567");
  });

  it("rejects too-short or too-long input", () => {
    expect(normalizePhoneNumberE164("12345")).toBeNull();
    expect(normalizePhoneNumberE164("123456789012345678")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizePhoneNumberE164("   ")).toBeNull();
  });
});

describe("formatPhoneNumberForDisplay", () => {
  it("formats a US E.164 number for display", () => {
    expect(formatPhoneNumberForDisplay("+15551234567")).toBe("(555) 123-4567");
  });

  it("returns an empty string for null", () => {
    expect(formatPhoneNumberForDisplay(null)).toBe("");
  });
});

describe("clampLeadMinutes", () => {
  it("keeps values inside the allowed range", () => {
    expect(clampLeadMinutes(45)).toBe(45);
  });

  it("clamps below the minimum", () => {
    expect(clampLeadMinutes(1)).toBe(5);
  });

  it("clamps above the maximum", () => {
    expect(clampLeadMinutes(10_000)).toBe(24 * 60);
  });

  it("falls back to 30 for non-finite input", () => {
    expect(clampLeadMinutes(Number.NaN)).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import {
  extractVinCandidates,
  keywordScore,
  normalizeKeywordToken,
} from "./keyword-match";

describe("normalizeKeywordToken", () => {
  it("strips possessives and simple plurals", () => {
    expect(normalizeKeywordToken("wife's")).toBe("wife");
    expect(normalizeKeywordToken("son's")).toBe("son");
    expect(normalizeKeywordToken("porsches")).toBe("porsche");
  });
});

describe("extractVinCandidates", () => {
  it("finds Porsche and standard VIN forms", () => {
    expect(
      extractVinCandidates(
        "CARFAX Vehicle History Report for this 2014 PORSCHE CAYMAN S: WP0AB2A87EK190468",
      ),
    ).toEqual(["WP0AB2A87EK190468"]);
  });
});

describe("keywordScore VIN lookups", () => {
  const title =
    "CARFAX Vehicle History Report for this 2014 PORSCHE CAYMAN S: WP0AB2A87EK190468";

  it("matches plural brand + VIN questions against the title VIN", () => {
    expect(keywordScore("what is my porsches vin", title)).toBe(1);
    expect(keywordScore("what is my porsche vin", title)).toBe(1);
  });

  it("still scores family questions after stopword filtering", () => {
    const memory =
      "domain=family My wife is Sandra Hernandez and she has a cousin named Raisa Fernandez";
    expect(keywordScore("What is my wife's name?", memory)).toBeGreaterThan(0.2);
  });
});

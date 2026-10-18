import { describe, expect, it } from "vitest";
import {
  extractVinCandidates,
  freeRetrievalTerms,
  freeTextRelevance,
  keywordScore,
  normalizeKeywordToken,
  rankFreeTextMatches,
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

describe("free Ask retrieval ranking", () => {
  const target = {
    id: "evernote-psychiatry-link",
    kind: "evernote",
    title: "Adding and editing a web link on the Psychiatry website",
    text: "A realistic 339-character imported note body about editing links.",
  };
  const receipts = Array.from({ length: 30 }, (_, index) => ({
    id: `gmail-receipt-${index}`,
    kind: "gmail",
    title: `Receipt ${index + 1}`,
    text: `Gmail purchase receipt with a website link and editing subscription ${index + 1}.`,
  }));
  const otherEvernote = {
    id: "evernote-ebay",
    kind: "evernote",
    title: "Sell It Now! eBay",
    text: "An old Evernote copy about adding a web listing.",
  };
  const reorderedTitle = {
    id: "evernote-reordered-title",
    kind: "evernote",
    title: "Psychiatry website: editing and adding a web link",
    text: "A different imported note with the same title words.",
  };
  const records = [...receipts, otherEvernote, target];

  it.each([
    'What does my note "Adding and editing a web link on the Psychiatry website" say?',
    "Tell me what the Psychiatry website note says",
    "Read my note about adding a link to the Psychiatry site",
  ])("ranks the matching title first for %s", (query) => {
    const ranked = rankFreeTextMatches(query, records, 8);
    expect(ranked[0]?.id).toBe(target.id);
    expect(ranked[0]?.titleMatches).toBeGreaterThanOrEqual(2);
  });

  it("breaks all-word ties in favor of the exact normalized title order", () => {
    const ranked = rankFreeTextMatches(
      'What does my note "Adding and editing a web link on the Psychiatry website" say?',
      [reorderedTitle, target],
    );
    expect(ranked[0]).toMatchObject({ id: target.id, exactTitle: true });
    expect(ranked[1]).toMatchObject({
      id: reorderedTitle.id,
      exactTitle: false,
    });
  });

  it("drops conversational filler and normalizes simple paraphrases", () => {
    expect(
      freeRetrievalTerms(
        'What does my note "Adding and editing a web link on the Psychiatry website" say?',
      ),
    ).toEqual(["add", "edit", "web", "link", "psychiatry", "website"]);
    expect(freeRetrievalTerms("Psychiatry site")).toEqual([
      "psychiatry",
      "website",
    ]);
    expect(freeRetrievalTerms("what does it say?")).toEqual([]);
  });

  it("returns no candidate for a truly absent topic", () => {
    expect(
      rankFreeTextMatches("quasar telescope maintenance", records, 8),
    ).toEqual([]);
    expect(
      freeTextRelevance(
        "quasar telescope maintenance",
        target.title,
        target.text,
      ).score,
    ).toBe(0);
  });

  it("retrieves a URL-only note whose topic is supplied by its tag", () => {
    const psychiatryLink = {
      id: "evernote-tagged-link",
      kind: "evernote",
      title: "Web link",
      text: "tags=Psychiatry\nhttps://example.com/resources",
    };
    const ranked = rankFreeTextMatches(
      "what's my psychiatry link",
      [...receipts, otherEvernote, psychiatryLink],
      8,
    );

    expect(ranked[0]).toMatchObject({
      id: psychiatryLink.id,
      allTerms: true,
      matchedTerms: 2,
    });
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
    expect(keywordScore("What is my wife's name?", memory)).toBeGreaterThan(
      0.2,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  keywordScore,
  mentionedPeople,
  namesFuzzyMatch,
  normalizeKeywordToken,
  peopleMatchingRelation,
  relationTermsInQuestion,
  textFuzzyHasName,
} from "./retrieval";
import { FAMILY_RELATION_INTENT, PERSON_INTENT, WAITING_INTENT } from "./query-utils";

describe("mentionedPeople", () => {
  const people = [
    { id: "p1", displayName: "Mike Hernandez" },
    { id: "p2", displayName: "Jane Doe" },
    { id: "p3", displayName: "Will Smith" },
  ];

  it("matches full display names in the question", () => {
    expect(mentionedPeople("What do I know about Mike Hernandez?", people)).toEqual([
      people[0],
    ]);
  });

  it("matches a unique first name of a known person", () => {
    expect(mentionedPeople("Follow up with Jane about the permit", people)).toEqual([
      people[1],
    ]);
  });

  it("skips ambiguous first names like Will", () => {
    expect(mentionedPeople("Will the permit be ready?", people)).toEqual([]);
  });

  it("returns empty when no known people are named", () => {
    expect(mentionedPeople("How much did I spend this month?", people)).toEqual([]);
  });

  it("prefers full-name match over first-name alone", () => {
    const both = [
      { id: "a", displayName: "Mike Chen" },
      { id: "b", displayName: "Mike Hernandez" },
    ];
    expect(mentionedPeople("Ask Mike Hernandez for the quote", both)).toEqual([both[1]]);
  });

  it("fuzzy-matches typos in a unique first name", () => {
    const wife = [{ id: "s1", displayName: "Sandra Hernandez" }];
    expect(mentionedPeople("email from sandrra", wife)).toEqual([wife[0]]);
  });
});

describe("family relation retrieval helpers", () => {
  it("extracts relation terms including possessives", () => {
    expect(relationTermsInQuestion("What is my wife's name?")).toEqual(["wife"]);
    expect(relationTermsInQuestion("Tell me about my son and daughter")).toEqual(
      expect.arrayContaining(["son", "daughter"]),
    );
  });

  it("matches people by role/notes relation", () => {
    const people = [
      { id: "s1", displayName: "Sandra Hernandez", role: "wife", notes: null },
      { id: "k1", displayName: "Kenneth", role: "son", notes: null },
      { id: "m1", displayName: "Mike", role: "friend", notes: null },
    ];
    expect(peopleMatchingRelation("What is my wife's name?", people)).toEqual([people[0]]);
    expect(peopleMatchingRelation("Who is my son?", people)).toEqual([people[1]]);
  });

  it("normalizes possessive keyword tokens", () => {
    expect(normalizeKeywordToken("wife's")).toBe("wife");
    expect(normalizeKeywordToken("son's")).toBe("son");
  });

  it("scores wife questions against family memory text", () => {
    const memory =
      "domain=family My wife is Sandra Hernandez and she has a cousin named Raisa Fernandez";
    expect(keywordScore("What is my wife's name?", memory)).toBeGreaterThan(0.2);
    expect(memory.toLowerCase()).toContain("sandra hernandez");
  });

  it("treats relation words in domain=other memories as family-relevant", () => {
    expect(relationTermsInQuestion("What is my niece's name?")).toEqual(["niece"]);
    const other =
      "domain=other my niece's name is Melissa Rodrigues\nmy brother in lae's name is Paul Rodrigues";
    expect(keywordScore("What is my niece's name?", other)).toBeGreaterThan(0.15);
  });
  it("fuzzy-matches Kayla to Khaila", () => {
    expect(namesFuzzyMatch("kayla", "khaila")).toBe(true);
    expect(textFuzzyHasName("my daughter khaila's boyfriend is Luis", "kayla")).toBe(true);
  });

  it("fuzzy-matches boyfrind to boyfriend in memory text", () => {
    expect(namesFuzzyMatch("boyfrind", "boyfriend")).toBe(true);
  });
});

describe("PERSON_INTENT / FAMILY_RELATION_INTENT / WAITING_INTENT", () => {
  it("detects about-person questions", () => {
    expect(PERSON_INTENT.test("What do I know about Mike?")).toBe(true);
    expect(PERSON_INTENT.test("Tell me about Jane Doe")).toBe(true);
    expect(PERSON_INTENT.test("What is my wife's name?")).toBe(true);
  });

  it("detects family relation questions", () => {
    expect(FAMILY_RELATION_INTENT.test("What is my wife's name?")).toBe(true);
    expect(FAMILY_RELATION_INTENT.test("When is my sister's birthday?")).toBe(true);
    expect(FAMILY_RELATION_INTENT.test("How much did I spend?")).toBe(false);
  });

  it("detects waiting questions", () => {
    expect(WAITING_INTENT.test("What am I waiting on from other people?")).toBe(true);
  });

  it("about-person questions can also match waiting when both present", () => {
    const q = "What do I know about Mike? What am I waiting on from them?";
    expect(PERSON_INTENT.test(q)).toBe(true);
    expect(WAITING_INTENT.test(q)).toBe(true);
  });
});

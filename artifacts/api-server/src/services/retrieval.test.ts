import { describe, expect, it } from "vitest";
import { mentionedPeople } from "./retrieval";
import { PERSON_INTENT, WAITING_INTENT } from "./query-utils";

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

describe("PERSON_INTENT / WAITING_INTENT", () => {
  it("detects about-person questions", () => {
    expect(PERSON_INTENT.test("What do I know about Mike?")).toBe(true);
    expect(PERSON_INTENT.test("Tell me about Jane Doe")).toBe(true);
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

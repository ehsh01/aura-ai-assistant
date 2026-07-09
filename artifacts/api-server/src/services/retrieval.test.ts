import { describe, expect, it } from "vitest";
import { mentionedPeople } from "./retrieval";

describe("mentionedPeople", () => {
  const people = [
    { id: "p1", displayName: "Mike Hernandez" },
    { id: "p2", displayName: "Jane Doe" },
  ];

  it("matches full display names in the question", () => {
    expect(mentionedPeople("What do I know about Mike Hernandez?", people)).toEqual([
      people[0],
    ]);
  });

  it("matches first names of known people", () => {
    expect(mentionedPeople("Follow up with Jane about the permit", people)).toEqual([
      people[1],
    ]);
  });

  it("returns empty when no known people are named", () => {
    expect(mentionedPeople("How much did I spend this month?", people)).toEqual([]);
  });
});

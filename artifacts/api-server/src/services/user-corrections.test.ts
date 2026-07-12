import { describe, expect, it } from "vitest";
import {
  peopleWithAliasNames,
  resolvePersonIdFromAliases,
} from "./user-corrections";
import { matchPersonId } from "./waiting-on";
import { mentionedPeople } from "./retrieval";

describe("person name aliases", () => {
  const aliases = new Map([
    ["mike h", "p1"],
    ["old.mike@example.com", "p1"],
  ]);

  const people = [
    { id: "p1", displayName: "Mike Hernandez", email: "mike@example.com" },
    { id: "p2", displayName: "Jane Doe", email: null as string | null },
  ];

  it("resolves former display names and emails to the person id", () => {
    expect(resolvePersonIdFromAliases("Mike H", aliases)).toBe("p1");
    expect(resolvePersonIdFromAliases("old.mike@example.com", aliases)).toBe("p1");
    expect(resolvePersonIdFromAliases("Jane", aliases)).toBeNull();
  });

  it("expands people so Ask can match former names", () => {
    const expanded = peopleWithAliasNames(people, aliases);
    expect(expanded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", displayName: "Mike Hernandez" }),
        expect.objectContaining({ id: "p1", displayName: "mike h" }),
        expect.objectContaining({ id: "p1", displayName: "old.mike@example.com" }),
      ]),
    );
  });

  it("matchPersonId uses aliases for renamed people", () => {
    expect(matchPersonId("Mike H", people, aliases)).toBe("p1");
    expect(matchPersonId("Mike Hernandez", people, aliases)).toBe("p1");
  });

  it("mentionedPeople finds people by former names after expansion", () => {
    const expanded = peopleWithAliasNames(people, aliases);
    expect(mentionedPeople("Follow up with Mike H about the quote", expanded)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p1" })]),
    );
  });
});

import { describe, expect, it } from "vitest";
import { resolveEntityMention } from "./resolve-entities";

const PEOPLE = [
  { id: "p-carter", name: "John Carter" },
  { id: "p-smith", name: "John Smith" },
  { id: "p-maria", name: "Maria Gonzalez" },
];

const PROJECTS = [
  { id: "prj-smith", name: "Smith" },
  { id: "prj-cabinet", name: "Cabinet Remodel" },
];

describe("resolveEntityMention — people", () => {
  it("links a unique full-name match", () => {
    const result = resolveEntityMention("person", "Maria Gonzalez", PEOPLE);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("p-maria");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("asks which John instead of guessing", () => {
    const result = resolveEntityMention("person", "John", PEOPLE);
    expect(result.status).toBe("ambiguous");
    expect(result.id).toBeNull();
    expect(result.candidates.map((c) => c.id).sort()).toEqual(["p-carter", "p-smith"]);
    expect(result.question).toBe("Which John did you mean — John Carter or John Smith?");
  });

  it("links a first name when only one person has it", () => {
    const result = resolveEntityMention("person", "Maria", PEOPLE);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("p-maria");
  });

  it("prefers an exact match over other partial matches", () => {
    const people = [...PEOPLE, { id: "p-john", name: "John" }];
    const result = resolveEntityMention("person", "John", people);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("p-john");
  });

  it("lets a confirmed alias win over ambiguity", () => {
    const aliases = new Map([["john", "p-carter"]]);
    const result = resolveEntityMention("person", "John", PEOPLE, aliases);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("p-carter");
  });

  it("ignores an alias pointing at a record the user no longer has", () => {
    const aliases = new Map([["john", "p-deleted"]]);
    const result = resolveEntityMention("person", "John", PEOPLE, aliases);
    expect(result.status).toBe("ambiguous");
  });

  it("reports unmatched rather than inventing a person", () => {
    const result = resolveEntityMention("person", "Priya", PEOPLE);
    expect(result.status).toBe("unmatched");
    expect(result.id).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("does not match a name that merely shares a prefix", () => {
    const result = resolveEntityMention("person", "Jo", PEOPLE);
    expect(result.status).toBe("unmatched");
  });

  it("preserves the original wording as evidence", () => {
    const result = resolveEntityMention("person", "  John Carter  ", PEOPLE);
    expect(result.mention).toBe("John Carter");
    expect(result.id).toBe("p-carter");
  });

  it("lists three candidates readably", () => {
    const people = [
      { id: "a", name: "John Carter" },
      { id: "b", name: "John Smith" },
      { id: "c", name: "John Doe" },
    ];
    const result = resolveEntityMention("person", "John", people);
    expect(result.question).toBe(
      "Which John did you mean — John Carter, John Doe, or John Smith?",
    );
  });

  it("returns unmatched when the user has no people yet", () => {
    expect(resolveEntityMention("person", "John", []).status).toBe("unmatched");
  });
});

describe("resolveEntityMention — projects", () => {
  it("strips spoken filler around a project name", () => {
    const result = resolveEntityMention("project", "the Smith project", PROJECTS);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("prj-smith");
  });

  it("matches a bare project name", () => {
    const result = resolveEntityMention("project", "Smith", PROJECTS);
    expect(result.id).toBe("prj-smith");
  });

  it("matches a multi-word project by one distinctive word", () => {
    const result = resolveEntityMention("project", "Cabinet", PROJECTS);
    expect(result.status).toBe("resolved");
    expect(result.id).toBe("prj-cabinet");
  });

  it("asks when two projects share a word", () => {
    const projects = [
      { id: "a", name: "Cabinet Remodel" },
      { id: "b", name: "Cabinet Install" },
    ];
    const result = resolveEntityMention("project", "the cabinet project", projects);
    expect(result.status).toBe("ambiguous");
    expect(result.question).toContain("Cabinet Install");
  });

  it("does not confuse a person name with a project", () => {
    const result = resolveEntityMention("project", "Maria Gonzalez", PROJECTS);
    expect(result.status).toBe("unmatched");
  });

  it("ignores punctuation and casing", () => {
    const result = resolveEntityMention("project", "SMITH!", PROJECTS);
    expect(result.id).toBe("prj-smith");
  });

  it("returns unmatched for an empty mention", () => {
    expect(resolveEntityMention("project", "   ", PROJECTS).status).toBe("unmatched");
  });
});

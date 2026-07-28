import { describe, expect, it } from "vitest";
import {
  autoAcceptEligible,
  captureConfidenceLabel,
  matchCaptureLinks,
  normalizeCaptureTypes,
  primaryTypeToSuggestedType,
  suggestedTypeToType,
  type CaptureTypeLabel,
} from "./capture-classify";

describe("normalizeCaptureTypes", () => {
  it("keeps valid labels, dedupes, and preserves order", () => {
    expect(normalizeCaptureTypes(["task", "deadline", "task", "note"])).toEqual([
      "task",
      "deadline",
      "note",
    ]);
  });

  it("drops invalid labels and falls back when nothing valid remains", () => {
    expect(normalizeCaptureTypes(["bogus", 42], ["reference"])).toEqual(["reference"]);
    expect(normalizeCaptureTypes(undefined, ["note"])).toEqual(["note"]);
    expect(normalizeCaptureTypes("task", ["note"])).toEqual(["note"]);
  });
});

describe("primaryTypeToSuggestedType", () => {
  it("maps every v2 label onto the legacy inbox vocabulary", () => {
    const expected: Record<CaptureTypeLabel, string> = {
      task: "task",
      deadline: "reminder",
      follow_up: "task",
      note: "note",
      person_update: "note",
      project_update: "project_item",
      reference: "reference",
    };
    for (const [type, legacy] of Object.entries(expected)) {
      expect(primaryTypeToSuggestedType(type as CaptureTypeLabel)).toBe(legacy);
    }
  });
});

describe("suggestedTypeToType", () => {
  it("maps legacy types onto v2 labels", () => {
    expect(suggestedTypeToType("task")).toBe("task");
    expect(suggestedTypeToType("reminder")).toBe("deadline");
    expect(suggestedTypeToType("work_note")).toBe("note");
    expect(suggestedTypeToType("project_item")).toBe("project_update");
    expect(suggestedTypeToType("reference")).toBe("reference");
    expect(suggestedTypeToType("note")).toBe("note");
  });
});

describe("captureConfidenceLabel", () => {
  it("bands scores", () => {
    expect(captureConfidenceLabel(0.9)).toBe("high");
    expect(captureConfidenceLabel(0.8)).toBe("high");
    expect(captureConfidenceLabel(0.6)).toBe("needs_review");
    expect(captureConfidenceLabel(0.5)).toBe("needs_review");
    expect(captureConfidenceLabel(0.49)).toBe("uncertain");
    expect(captureConfidenceLabel(null)).toBe("uncertain");
    expect(captureConfidenceLabel(undefined)).toBe("uncertain");
  });
});

describe("autoAcceptEligible", () => {
  const matchedLinks = [
    { entityType: "person" as const, entityId: "p1", name: "Carlos", matched: true, reason: "Mentioned in capture" },
  ];

  it("accepts high-confidence, low-risk, undated captures with resolved links", () => {
    expect(
      autoAcceptEligible({ types: ["task"], confidence: 0.9, dueDate: null, links: [] }),
    ).toBe(true);
    expect(
      autoAcceptEligible({ types: ["note", "reference"], confidence: 0.85, dueDate: null, links: matchedLinks }),
    ).toBe(true);
  });

  it("rejects low confidence", () => {
    expect(
      autoAcceptEligible({ types: ["task"], confidence: 0.84, dueDate: null, links: [] }),
    ).toBe(false);
  });

  it("rejects dated captures (they go through deadline promotion instead)", () => {
    expect(
      autoAcceptEligible({ types: ["task"], confidence: 0.95, dueDate: "2026-08-01", links: [] }),
    ).toBe(false);
  });

  it("rejects consequential types even at high confidence", () => {
    for (const types of [["deadline"], ["follow_up"], ["person_update"], ["project_update"]] as const) {
      expect(
        autoAcceptEligible({ types: [...types], confidence: 0.95, dueDate: null, links: [] }),
      ).toBe(false);
    }
  });

  it("rejects unresolved names (never silently create people or projects)", () => {
    const unmatched = [
      { entityType: "project" as const, entityId: null, name: "Kitchen remodel", matched: false, reason: "Mentioned in capture" },
    ];
    expect(
      autoAcceptEligible({ types: ["note"], confidence: 0.95, dueDate: null, links: unmatched }),
    ).toBe(false);
  });
});

describe("matchCaptureLinks", () => {
  const people = [
    { id: "p1", displayName: "Carlos Mendez" },
    { id: "p2", displayName: "Sandra" },
  ];
  const aliases = new Map([["carlos", "p1"]]);
  const matchPerson = (name: string) => {
    const lower = name.toLowerCase();
    return (
      aliases.get(lower) ??
      people.find(
        (p) =>
          p.displayName.toLowerCase() === lower ||
          p.displayName.toLowerCase().includes(lower) ||
          lower.includes(p.displayName.toLowerCase()),
      )?.id ??
      null
    );
  };
  const projects = [{ id: "pr1", name: "Kitchen remodel" }];

  it("matches a person via alias", () => {
    const [link] = matchCaptureLinks({ personName: "Carlos" }, { projects, matchPerson });
    expect(link).toMatchObject({
      entityType: "person",
      entityId: "p1",
      name: "Carlos",
      matched: true,
      reason: "Mentioned in capture",
    });
  });

  it("matches a project case-insensitively", () => {
    const [link] = matchCaptureLinks(
      { projectName: "kitchen REMODEL" },
      { projects, matchPerson },
    );
    expect(link).toMatchObject({ entityType: "project", entityId: "pr1", matched: true });
  });

  it("never creates: unknown names stay name-only suggestions", () => {
    const [personLink, projectLink] = matchCaptureLinks(
      { personName: "Nobody Known", projectName: "Unknown project" },
      { projects, matchPerson },
    );
    expect(personLink).toMatchObject({ entityType: "person", entityId: null, matched: false });
    expect(projectLink).toMatchObject({ entityType: "project", entityId: null, matched: false });
  });

  it("returns no links when nothing is named", () => {
    expect(matchCaptureLinks({}, { projects, matchPerson })).toEqual([]);
    expect(
      matchCaptureLinks({ personName: "  ", projectName: null }, { projects, matchPerson }),
    ).toEqual([]);
  });
});

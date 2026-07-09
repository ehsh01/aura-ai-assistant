import { describe, expect, it } from "vitest";
import { extractPerson, matchPersonId } from "./waiting-on";

/**
 * Contract for inbox accept person resolution (mirrors resolvePersonForAccept
 * without hitting the DB).
 */
function resolveNameFromCapture(
  title: string,
  rawText: string,
  peopleNames: string[],
): string | null {
  const extracted = extractPerson(`${title}\n${rawText}`, peopleNames);
  return extracted === "Someone" ? null : extracted;
}

describe("inbox accept person resolution", () => {
  it("extracts a person from follow-up style captures", () => {
    expect(
      resolveNameFromCapture(
        "Call Mike about the quote",
        "Need to call Mike about the drywall quote before Friday.",
        [],
      ),
    ).toBe("Mike");
  });

  it("prefers known people over bare extraction", () => {
    expect(
      resolveNameFromCapture(
        "Waiting on reply from Mike",
        "Still waiting on Mike for the permit.",
        ["Mike Hernandez"],
      ),
    ).toBe("Mike Hernandez");
  });

  it("matches existing person ids by name", () => {
    const id = matchPersonId("Mike", [
      { id: "p1", displayName: "Mike Hernandez" },
      { id: "p2", displayName: "Jane Doe" },
    ]);
    expect(id).toBe("p1");
  });

  it("returns null when no person signal", () => {
    expect(
      resolveNameFromCapture("Buy groceries", "milk eggs bread", []),
    ).toBeNull();
  });
});

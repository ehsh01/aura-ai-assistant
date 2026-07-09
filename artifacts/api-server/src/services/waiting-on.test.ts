import { describe, expect, it } from "vitest";
import { extractPerson } from "./waiting-on";

describe("extractPerson (waiting-on)", () => {
  it("does not swallow the next sentence word after a name", () => {
    expect(
      extractPerson("Waiting on quote from Mike Still need the drywall quote", []),
    ).toBe("Mike");
  });

  it("keeps two-word names when both look like names", () => {
    expect(extractPerson("waiting on reply from Jane Doe about the permit", [])).toBe(
      "Jane Doe",
    );
  });

  it("prefers known people names", () => {
    expect(
      extractPerson("Still need the quote from Mike", ["Mike Hernandez"]),
    ).toBe("Mike Hernandez");
  });

  it("extracts the person after Call/Email verbs", () => {
    expect(extractPerson("Call Mike about the quote", [])).toBe("Mike");
  });

  it("ignores imperative verbs without a person", () => {
    expect(extractPerson("Buy groceries", [])).toBe("Someone");
  });
});

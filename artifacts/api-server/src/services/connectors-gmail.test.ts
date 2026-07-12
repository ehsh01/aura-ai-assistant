import { describe, expect, it } from "vitest";
import { buildGmailSearchQuery } from "./connectors";

describe("buildGmailSearchQuery", () => {
  it("builds from: queries for sender questions", () => {
    expect(buildGmailSearchQuery("Okay, look for emails from Nancy Bryant.")).toBe(
      "from:(Nancy Bryant)",
    );
    expect(buildGmailSearchQuery("emails from Sandra Hernandez")).toBe(
      "from:(Sandra Hernandez)",
    );
  });

  it("builds topic queries for about questions", () => {
    expect(buildGmailSearchQuery("emails about the permit")).toBe("the permit");
  });

  it("returns null for non-mail questions", () => {
    expect(buildGmailSearchQuery("How much did I spend?")).toBeNull();
  });
});

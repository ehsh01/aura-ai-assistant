import { describe, expect, it } from "vitest";
import { redactLogArguments } from "./logger";

describe("logger credential boundary", () => {
  it("redacts secrets from strings, metadata, and errors", () => {
    const secret = "FakePsychiatryPassword!42";
    const args = redactLogArguments([
      `password: ${secret}`,
      { context: `pwd=${secret}` },
      new Error(`Bearer ghp_FakeGithubToken1234567890`),
    ]);
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("ghp_FakeGithubToken1234567890");
    expect(serialized).toContain("[hidden credential]");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildNotesTsQuery,
  getHostnameFallbackTimeoutCount,
  hostnameFallbackTerm,
  hostnameFallbackRegex,
  runHostnameFallbackSafely,
  shouldExpandUrlTokens,
} from "./notes";

describe("buildNotesTsQuery", () => {
  it("builds prefix AND queries for short term lists", () => {
    expect(buildNotesTsQuery(["costa", "rica"])).toBe("costa:* & rica:*");
    expect(buildNotesTsQuery(["vin", "porsche", "cayenne"])).toBe(
      "vin:* & porsche:* & cayenne:*",
    );
  });

  it("builds OR queries for longer conversational term lists", () => {
    expect(buildNotesTsQuery(["costa", "rica", "trip", "itinerary"])).toBe(
      "costa:* | rica:* | trip:* | itinerary:*",
    );
  });

  it("rejects unsafe tokens", () => {
    expect(buildNotesTsQuery(["ok", "bad;drop"])).toBe("ok:*");
    expect(buildNotesTsQuery([])).toBeNull();
  });

  it("uses one selective term for bounded hostname fallback", () => {
    expect(
      hostnameFallbackTerm(
        "[AppSmith test] what is the Psychiatry website link",
      ),
    ).toBe("psychiatry");
    expect(hostnameFallbackRegex("psychiatry")).toBe(
      "((^|[^a-z0-9])psychiatry[.-]|[.-]psychiatry([^a-z0-9]|$))",
    );
    expect(shouldExpandUrlTokens("khaila school portal link")).toBe(true);
    expect(shouldExpandUrlTokens("ordinary note summary")).toBe(false);
  });

  it("degrades gracefully and counts hostname fallback timeouts", async () => {
    const before = getHostnameFallbackTimeoutCount();
    const timeout = Object.assign(new Error("statement timeout"), {
      code: "57014",
    });
    await expect(
      runHostnameFallbackSafely(
        async () => {
          throw timeout;
        },
        [] as string[],
      ),
    ).resolves.toEqual([]);
    expect(getHostnameFallbackTimeoutCount()).toBe(before + 1);
  });
  it("degrades gracefully when Drizzle wraps the hostname timeout", async () => {
    const before = getHostnameFallbackTimeoutCount();
    const timeout = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("canceling statement due to timeout"), {
        code: "57014",
      }),
    });
    await expect(
      runHostnameFallbackSafely(
        async () => {
          throw timeout;
        },
        [] as string[],
      ),
    ).resolves.toEqual([]);
    expect(getHostnameFallbackTimeoutCount()).toBe(before + 1);
  });

});

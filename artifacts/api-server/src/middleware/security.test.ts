import { describe, expect, it } from "vitest";
import { evaluateCorsRequest } from "./security";

describe("extension CORS boundary", () => {
  it("allows extension preflight and POST only for raw capture intake", () => {
    const origin = "chrome-extension://abcdefghijklmnop";
    expect(
      evaluateCorsRequest({ origin, path: "/api/captures", method: "OPTIONS" }),
    ).toEqual({ allowed: true, browserExtension: true });
    expect(
      evaluateCorsRequest({ origin, path: "/api/captures", method: "POST" }),
    ).toEqual({ allowed: true, browserExtension: true });
  });

  it("blocks extension access to personal-data routes", () => {
    const origin = "chrome-extension://abcdefghijklmnop";
    expect(
      evaluateCorsRequest({ origin, path: "/api/notes", method: "GET" }).allowed,
    ).toBe(false);
    expect(
      evaluateCorsRequest({ origin, path: "/api/ai/query", method: "POST" }).allowed,
    ).toBe(false);
  });

  it("allows server-to-server requests without an Origin header", () => {
    expect(
      evaluateCorsRequest({ path: "/api/health", method: "GET" }),
    ).toEqual({ allowed: true, browserExtension: false });
  });
});

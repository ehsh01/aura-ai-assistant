import { describe, expect, it } from "vitest";
import { isAppPath } from "./app-path";

describe("isAppPath", () => {
  it("keeps Today category detail routes inside the signed-in app", () => {
    expect(isAppPath("/today/cracks")).toBe(true);
    expect(isAppPath("/today/finance")).toBe(true);
  });

  it("still rejects unknown routes", () => {
    expect(isAppPath("/todayish/cracks")).toBe(false);
    expect(isAppPath("/unknown")).toBe(false);
  });
});

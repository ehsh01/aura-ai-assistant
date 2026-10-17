import { describe, expect, it } from "vitest";
import { isAppPath } from "./app-path";

describe("isAppPath", () => {
  it("keeps Today category detail routes inside the signed-in app", () => {
    expect(isAppPath("/today/cracks")).toBe(true);
    expect(isAppPath("/today/finance")).toBe(true);
    expect(isAppPath("/everything/item-1")).toBe(true);
    expect(isAppPath("/people/person-1")).toBe(true);
    expect(isAppPath("/waiting")).toBe(true);
    expect(isAppPath("/waiting/wait-1")).toBe(true);
  });

  it("still rejects unknown routes", () => {
    expect(isAppPath("/todayish/cracks")).toBe(false);
    expect(isAppPath("/unknown")).toBe(false);
  });
});

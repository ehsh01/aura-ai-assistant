import { describe, expect, it } from "vitest";
import { APP_PATHS, isAppPath, normalizedAppPath } from "./app-path";

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

  it("covers every former inline normalizer route and strips index.html", () => {
    for (const path of APP_PATHS) {
      expect(normalizedAppPath(path)).toBe(path);
    }
    for (const path of [
      "/projects/project-1",
      "/waiting/wait-1",
      "/today/finance",
      "/everything/item-1",
      "/people/person-1",
    ]) {
      expect(normalizedAppPath(path)).toBe(path);
    }
    expect(normalizedAppPath("/index.html")).toBe("/");
    expect(normalizedAppPath("/notes/index.html")).toBe("/notes");
    expect(normalizedAppPath("/not-a-route")).toBe("/");
  });
});

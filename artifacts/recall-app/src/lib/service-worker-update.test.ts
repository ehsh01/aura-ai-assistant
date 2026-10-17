import { describe, expect, it } from "vitest";
import {
  buildReloadGuardKey,
  decideBuildReload,
} from "./service-worker-update";

describe("service worker build reload guard", () => {
  it("reloads at most once for each new build id", () => {
    const first = decideBuildReload({
      currentBuildId: "old",
      nextBuildId: "new",
      alreadyReloaded: false,
      hasUnsafeInput: false,
    });
    const repeated = decideBuildReload({
      currentBuildId: "old",
      nextBuildId: "new",
      alreadyReloaded: true,
      hasUnsafeInput: false,
    });

    expect(buildReloadGuardKey("new")).toBe("recall:reloaded-build:new");
    expect(first).toBe("reload");
    expect(repeated).toBe("already-reloaded");
  });

  it("does not reload when the activated build is already current", () => {
    expect(
      decideBuildReload({
        currentBuildId: "same",
        nextBuildId: "same",
        alreadyReloaded: false,
        hasUnsafeInput: false,
      }),
    ).toBe("same-build");
  });

  it("defers reload while a focused or dirty text entry is unsafe", () => {
    expect(
      decideBuildReload({
        currentBuildId: "old",
        nextBuildId: "new",
        alreadyReloaded: false,
        hasUnsafeInput: true,
      }),
    ).toBe("defer-for-input");
  });
});

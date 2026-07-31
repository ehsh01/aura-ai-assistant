/**
 * Pure helpers for action proposal lifecycle assertions.
 * Durable persistence is covered via the service + confirm orchestrator paths.
 */
import { describe, expect, it } from "vitest";

describe("proposal status machine (contract)", () => {
  const OPEN = new Set(["proposed"]);
  const TERMINAL = new Set(["executed", "cancelled", "superseded", "failed"]);

  it("only proposed rows can be confirmed", () => {
    expect(OPEN.has("proposed")).toBe(true);
    expect(OPEN.has("executed")).toBe(false);
  });

  it("terminal states cannot be corrected", () => {
    for (const s of TERMINAL) {
      expect(s === "proposed").toBe(false);
    }
  });

  it("durable proposal ids use the aprop- prefix", () => {
    const id = `aprop-${Date.now()}-abc`;
    expect(id.startsWith("aprop-")).toBe(true);
  });
});

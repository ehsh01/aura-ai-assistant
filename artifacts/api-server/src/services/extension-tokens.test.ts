import { describe, expect, it } from "vitest";
import {
  generateExtensionTokenValue,
  hashExtensionToken,
  isExtensionToken,
  isExtensionTokenRecordUsable,
} from "./extension-tokens";

describe("extension token security primitives", () => {
  it("creates opaque capture-token values instead of JWTs", () => {
    const token = generateExtensionTokenValue();
    expect(token).toMatch(/^recall_ext_[A-Za-z0-9_-]{40,}$/);
    expect(token.split(".")).toHaveLength(1);
    expect(isExtensionToken(token)).toBe(true);
    expect(isExtensionToken("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBe(false);
  });

  it("stores only a deterministic SHA-256 hash", () => {
    const token = generateExtensionTokenValue();
    const hash = hashExtensionToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashExtensionToken(token)).toBe(hash);
    expect(hashExtensionToken(`${token}x`)).not.toBe(hash);
  });

  it("generates unique token values", () => {
    expect(generateExtensionTokenValue()).not.toBe(generateExtensionTokenValue());
  });

  it("rejects expired, revoked, and incorrectly scoped records", () => {
    const now = new Date("2026-07-12T20:00:00.000Z");
    const active = {
      scope: "capture:create",
      expiresAt: new Date("2026-07-13T20:00:00.000Z"),
      revokedAt: null,
    };

    expect(isExtensionTokenRecordUsable(active, now)).toBe(true);
    expect(
      isExtensionTokenRecordUsable(
        { ...active, expiresAt: new Date("2026-07-12T19:59:59.000Z") },
        now,
      ),
    ).toBe(false);
    expect(
      isExtensionTokenRecordUsable({ ...active, revokedAt: now }, now),
    ).toBe(false);
    expect(
      isExtensionTokenRecordUsable({ ...active, scope: "account:read" }, now),
    ).toBe(false);
  });
});

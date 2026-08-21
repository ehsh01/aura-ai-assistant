import { afterEach, describe, expect, it } from "vitest";
import { assertSecretEncryptionConfigured, openSecret, sealConnectorSettings, sealSecret } from "./secret-box";

const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  } else {
    process.env.SECRETS_ENCRYPTION_KEY = originalKey;
  }
});

describe("production secret encryption guard", () => {
  it("fails closed in production when the key is missing", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(() => assertSecretEncryptionConfigured(true)).toThrow(
      "SECRETS_ENCRYPTION_KEY is required in production",
    );
  });

  it("allows development without a key", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(() => assertSecretEncryptionConfigured(false)).not.toThrow();
  });

  it("accepts a configured production key", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    expect(() => assertSecretEncryptionConfigured(true)).not.toThrow();
  });
});

describe("connector apiKey sealing", () => {
  it("encrypts apiKey and round-trips", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "b".repeat(64);
    const sealed = sealConnectorSettings({ apiKey: "ff-secret", email: "a@b.com" });
    expect(typeof sealed.apiKey).toBe("string");
    expect(String(sealed.apiKey)).not.toBe("ff-secret");
    expect(String(sealed.apiKey).startsWith("v1.")).toBe(true);
    expect(sealed.email).toBe("a@b.com");
    expect(openSecret(String(sealed.apiKey))).toBe("ff-secret");
    expect(sealSecret("ff-secret").startsWith("v1.")).toBe(true);
  });
});

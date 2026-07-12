import { afterEach, describe, expect, it } from "vitest";
import { assertSecretEncryptionConfigured } from "./secret-box";

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

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = 1;
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function resolveKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  // Accept 64-char hex or any passphrase (scrypt-derived).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return scryptSync(raw, "recall-secrets-v1", KEY_LEN);
}

/**
 * Encrypt a UTF-8 string for storage (AES-256-GCM).
 * Returns a versioned base64 blob: v1.<iv>.<tag>.<ciphertext>
 * When SECRETS_ENCRYPTION_KEY is unset, returns the plaintext unchanged
 * (dev-only convenience — production must set the key).
 */
export function sealSecret(plaintext: string): string {
  const key = resolveKey();
  if (!key) return plaintext;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${VERSION}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function openSecret(blob: string): string {
  if (!blob.startsWith("v1.")) return blob;
  const key = resolveKey();
  if (!key) {
    throw new Error("SECRETS_ENCRYPTION_KEY required to decrypt sealed secret");
  }
  const parts = blob.split(".");
  if (parts.length !== 4) throw new Error("Invalid sealed secret format");
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const data = Buffer.from(dataB64!, "base64url");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Invalid sealed secret lengths");
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Seal string fields commonly used for OAuth / API credentials. */
const SENSITIVE_SETTING_KEYS = [
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "password",
  "token",
] as const;

export function sealConnectorSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    const val = out[key];
    if (typeof val === "string" && val.length > 0 && !val.startsWith("v1.")) {
      out[key] = sealSecret(val);
    }
  }
  return out;
}

export function openConnectorSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    const val = out[key];
    if (typeof val === "string" && val.startsWith("v1.")) {
      out[key] = openSecret(val);
    }
  }
  return out;
}

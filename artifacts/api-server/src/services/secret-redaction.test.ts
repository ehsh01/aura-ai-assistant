import { describe, expect, it } from "vitest";
import {
  credentialReferenceAnswer,
  HIDDEN_CREDENTIAL,
  isCredentialRequest,
  redactCredentials,
  redactSensitiveValue,
} from "./secret-redaction";

export const FAKE_CREDENTIALS = {
  password: "FakePsychiatryPassword!42",
  spacesAccess: "DO00FAKEACCESSKEY123",
  spacesSecret: "FAKESECRETKEY1234567890123456789012345678",
  awsAccess: "AKIAFAKEACCESSKEY123",
  openAi: "sk-proj-FakeOpenAiKey1234567890",
  github: "ghp_FakeGithubToken1234567890",
  slack: "xoxb-fake-slack-token-123456",
  jwt: "eyJhbGciOiJIUzI1NiJ9.ZmFrZXBheWxvYWQ.ZmFrZXNpZ25hdHVyZQ",
};

export const PSYCHIATRY_SECRET_FIXTURE = `Psychiatry Inventory App
SSH host: inventory.example.health
SSH user: psychiatry-admin
SSH password: ${FAKE_CREDENTIALS.password}
Spaces access key: ${FAKE_CREDENTIALS.spacesAccess}
Spaces secret key: ${FAKE_CREDENTIALS.spacesSecret}
AWS access key: ${FAKE_CREDENTIALS.awsAccess}
API key: ${FAKE_CREDENTIALS.openAi}
Authorization: Bearer ${FAKE_CREDENTIALS.github}
Slack token: ${FAKE_CREDENTIALS.slack}
JWT: ${FAKE_CREDENTIALS.jwt}
Database: postgres://inventory:${FAKE_CREDENTIALS.password}@db.example.health:5432/psychiatry
-----BEGIN OPENSSH PRIVATE KEY-----
ZmFrZS1wcml2YXRlLWtleQ==
-----END OPENSSH PRIVATE KEY-----`;

describe("credential redaction", () => {
  it("redacts the fake Psychiatry credential fixture", () => {
    const redacted = redactCredentials(PSYCHIATRY_SECRET_FIXTURE);
    for (const secret of Object.values(FAKE_CREDENTIALS)) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).not.toContain("ZmFrZS1wcml2YXRlLWtleQ");
    expect(redacted).toContain(`SSH password: ${HIDDEN_CREDENTIAL}`);
    expect(redacted).toContain(
      `postgres://inventory:${HIDDEN_CREDENTIAL}@db.example.health`,
    );
    expect(redacted).toContain("SSH host: inventory.example.health");
    expect(redacted).toContain("SSH user: psychiatry-admin");
  });

  it("does not redact URLs, phone numbers, dates, or short numbers", () => {
    const safe = [
      "https://psychiatry.med.miami.edu",
      "https://secure.touchnet.net/central",
      "Call 305-555-0199 on 2026-10-18.",
      "Inventory count: 42",
      "Port: 5432",
    ].join("\n");
    expect(redactCredentials(safe)).toBe(safe);
  });

  it("redacts nested answer metadata without mutating raw input", () => {
    const raw = {
      answer: `Password: ${FAKE_CREDENTIALS.password}`,
      evidence: [{ evidenceText: `token=${FAKE_CREDENTIALS.github}` }],
    };
    const redacted = redactSensitiveValue(raw);
    expect(redacted).not.toBe(raw);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_CREDENTIALS.password);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_CREDENTIALS.github);
    expect(JSON.stringify(raw)).toContain(FAKE_CREDENTIALS.password);
  });

  it("recognizes credential requests and returns a safe note reference", () => {
    expect(isCredentialRequest("What is the SSH password?")).toBe(true);
    expect(isCredentialRequest("What is the Psychiatry website link?")).toBe(
      false,
    );
    expect(credentialReferenceAnswer("Psychiatry Inventory App")).toContain(
      "Open the note",
    );
  });
});

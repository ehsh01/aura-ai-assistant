import { describe, expect, it } from "vitest";
import {
  credentialReferenceAnswer,
  HIDDEN_CREDENTIAL,
  isCredentialRequest,
  redactCredentials,
  redactSensitiveValue,
  withCredentialRedactionScope,
} from "./secret-redaction";

export const FAKE_CREDENTIALS = {
  password: "FakePsychiatryPassword!42",
  spacesAccess: "DO00FAKEACCESSKEY123",
  spacesKey43: "QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12",
  spacesSecret: "FAKESECRETKEY1234567890123456789012345678",
  awsAccess: "AKIAFAKEACCESSKEY123",
  openAi: "sk-proj-FakeOpenAiKey1234567890",
  github: "ghp_FakeGithubToken1234567890",
  slack: "xoxb-fake-slack-token-123456",
  jwt: "eyJhbGciOiJIUzI1NiJ9.ZmFrZXBheWxvYWQ.ZmFrZXNpZ25hdHVyZQ",
  sshBare: "Abc123xyzAbc123xyz@Q@Wordtail9",
  commandToken: "Abc123xyzAbc123xyz@Q@Wordtail9",
};

export const PSYCHIATRY_SECRET_FIXTURE = `Psychiatry Inventory App
SSH host: inventory.example.health
SSH user: psychiatry-admin
SSH password: ${FAKE_CREDENTIALS.password}
Spaces access key: ${FAKE_CREDENTIALS.spacesAccess}
Spaces Key: ${FAKE_CREDENTIALS.spacesKey43}
Spaces secret key: ${FAKE_CREDENTIALS.spacesSecret}
AWS access key: ${FAKE_CREDENTIALS.awsAccess}
API key: ${FAKE_CREDENTIALS.openAi}
Authorization: Bearer ${FAKE_CREDENTIALS.github}
Slack token: ${FAKE_CREDENTIALS.slack}
JWT: ${FAKE_CREDENTIALS.jwt}
Database: postgres://inventory:${FAKE_CREDENTIALS.password}@db.example.health:5432/psychiatry
ssh root@1.2.3.4
${FAKE_CREDENTIALS.sshBare}
deploy user:${FAKE_CREDENTIALS.commandToken}/var/www/x
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
    expect(redacted).not.toContain("Wordtail9");
    expect(redacted).not.toContain("@Q@");
    expect(redacted).toContain(
      `deploy user:${HIDDEN_CREDENTIAL}/var/www/x`,
    );
    expect(redacted).toContain(`SSH password: ${HIDDEN_CREDENTIAL}`);
    expect(redacted).toContain(
      `postgres://inventory:${HIDDEN_CREDENTIAL}@db.example.health`,
    );
    expect(redacted).toContain("SSH host: inventory.example.health");
    expect(redacted).toContain("SSH user: psychiatry-admin");
    expect(FAKE_CREDENTIALS.spacesKey43).toHaveLength(43);
  });

  it("does not redact URLs, phone numbers, dates, or short numbers", () => {
    const safe = [
      "https://psychiatry.med.miami.edu",
      "https://secure.touchnet.net/central",
      "Call 305-555-0199 on 2026-10-18.",
      "Inventory count: 42",
      "Port: 5432",
      "UUID: 123e4567-e89b-12d3-a456-426614174000",
      "Commit: a878db24e5f53c80460b24ed9e17e9e8abbe74b8",
      "https://psychiatry.med.miami.edu/path/AbCdEf1234567890AbCdEf1234567890",
    ].join("\n");
    expect(redactCredentials(safe)).toBe(safe);
  });

  it("redacts sshpass and same-line SSH password tokens", () => {
    const input =
      "sshpass -p ShortFake! ssh root@1.2.3.4 SameLineFake!";
    const redacted = redactCredentials(input);
    expect(redacted).not.toContain("ShortFake!");
    expect(redacted).not.toContain("SameLineFake!");
  });

  it("redacts a no-host user credential greedily to the path separator", () => {
    const secret = "Abc123xyzAbc123xyz@Q@Wordtail9";
    expect(
      redactCredentials(`deploy user:${secret}/var/www/x`),
    ).toContain(`user:${HIDDEN_CREDENTIAL}/var/www/x`);
    expect(
      redactCredentials(
        `ssh root@1.2.3.4\n${secret}\ndeploy user:${secret}/var/www/x`,
      ),
    ).not.toContain("Wordtail9");
  });

  it.each([".", ",", ")"])(
    "does not treat a sentence-tail %s as a dotted host",
    (punctuation) => {
      const secret = "Abc123xyzAbc123xyz@Q@Wordtail9";
      const input = `key: user26:${secret}${punctuation}`;
      const redacted = redactCredentials(input);
      expect(redacted).toBe(`key: ${HIDDEN_CREDENTIAL}${punctuation}`);
      expect(redacted).not.toContain("Wordtail9");
    },
  );

  it("preserves non-secret email and SSH host forms byte-for-byte", () => {
    const safe = "Contact user@example.com.\nssh root@1.2.3.4.";
    expect(redactCredentials(safe)).toBe(safe);
  });

  it("uses the previous line as context for a bare Key label", () => {
    const secret = "QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12";
    expect(redactCredentials(`DigitalOcean Spaces\nKey: ${secret}`)).toBe(
      `DigitalOcean Spaces\nKey: ${HIDDEN_CREDENTIAL}`,
    );
  });

  it("collapses adjacent and partial credential placeholders", () => {
    expect(
      redactCredentials(
        "[hidden credential][hidden credential] credential]",
      ),
    ).toBe(HIDDEN_CREDENTIAL);
    expect(redactCredentials("The hidden panel is closed.")).toBe(
      "The hidden panel is closed.",
    );
  });

  it("consumes markup-glued labelled values through end of token", () => {
    const value = 'Ab1cD2e"><Fg3Hi4Jk5Lm6No7Pq';
    const redacted = redactCredentials(`key: ${value}`);
    expect(redacted).toBe(`key: ${HIDDEN_CREDENTIAL}`);
    expect(redacted).not.toContain("Fg3Hi4Jk5Lm6No7Pq");
    expect(redacted).not.toContain("[[hidden credential]");
  });

  it("is idempotent in one scope and across later scoped calls", () => {
    const source =
      'key: Ab1cD2e"><Fg3Hi4Jk5Lm6No7Pq\n' +
      "ssh root@1.2.3.4\nAbc123xyzAbc123xyz@Q@Wordtail9";
    withCredentialRedactionScope(() => {
      const once = redactCredentials(source);
      const twice = redactCredentials(once);
      expect(twice).toBe(once);
      expect(twice).not.toContain("[[");
      expect(twice).not.toContain("]]");
      expect(twice.split(HIDDEN_CREDENTIAL).join("")).not.toContain(
        "credential]",
      );
      expect(redactCredentials("Echo Wordtail9")).toBe(
        `Echo ${HIDDEN_CREDENTIAL}`,
      );
    });
  });

  it("is byte-idempotent across credential and placeholder fixtures", () => {
    const fixtures = [
      PSYCHIATRY_SECRET_FIXTURE,
      'key: Ab1cD2e"><Fg3Hi4Jk5Lm6No7Pq',
      "password is [hidden credential].",
      "key: [hidden credential],",
      "deploy user:Abc123xyzAbc123xyz@Q@Wordtail9/var/www/x",
      "The hidden panel is closed.",
    ];
    for (const fixture of fixtures) {
      withCredentialRedactionScope(() => {
        const once = redactCredentials(fixture);
        expect(redactCredentials(once)).toBe(once);
        expect(once).not.toContain("[[");
        expect(once).not.toContain("]]");
      });
    }
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

import { describe, expect, it } from "vitest";
import {
  credentialReferenceAnswer,
  HIDDEN_ADDRESS,
  HIDDEN_CREDENTIAL,
  isCredentialRequest,
  learnedAddressValues,
  learnedCredentialValues,
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
ssh root@10.20.30.40
${FAKE_CREDENTIALS.sshBare}
deploy user:${FAKE_CREDENTIALS.commandToken}/var/www/x
-----BEGIN OPENSSH PRIVATE KEY-----
ZmFrZS1wcml2YXRlLWtleQ==
-----END OPENSSH PRIVATE KEY-----`;

export const FAKE_SERVER_INVENTORY_FIXTURE = `Server Inventory
IP: 10.20.30.40
server: 10. 20.
DB: db-node.fake.internal:5432
Runbook: https://dadeschools.net/server-guide
SSH: deploy@inventory-node.fake.internal`;

describe("credential redaction", () => {
  it("redacts the fake Psychiatry credential fixture", () => {
    const redacted = redactCredentials(PSYCHIATRY_SECRET_FIXTURE);
    for (const secret of Object.values(FAKE_CREDENTIALS)) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).not.toContain("ZmFrZS1wcml2YXRlLWtleQ");
    expect(redacted).not.toContain("Wordtail9");
    expect(redacted).not.toContain("@Q@");
    expect(redacted).toContain(`deploy user:${HIDDEN_CREDENTIAL}/var/www/x`);
    expect(redacted).toContain(`SSH password: ${HIDDEN_CREDENTIAL}`);
    expect(redacted).toContain(
      `postgres://inventory:${HIDDEN_CREDENTIAL}@${HIDDEN_ADDRESS}`,
    );
    expect(redacted).toContain(`SSH host: ${HIDDEN_ADDRESS}`);
    expect(redacted).toContain("SSH user: psychiatry-admin");
    expect(FAKE_CREDENTIALS.spacesKey43).toHaveLength(43);
  });

  it("does not redact URLs, phone numbers, dates, or short numbers", () => {
    const safe = [
      "https://psychiatry.med.miami.edu",
      "http://smartersoftware.io/",
      "https://secure.touchnet.net/central",
      "https://dadeschools.net",
      "https://eappraisal.miami.edu",
      "Call 305-555-0199 on 2026-10-18.",
      "Inventory count: 42",
      "Port: 5432",
      "UUID: 123e4567-e89b-12d3-a456-426614174000",
      "Commit: a878db24e5f53c80460b24ed9e17e9e8abbe74b8",
      "https://psychiatry.med.miami.edu/path/AbCdEf1234567890AbCdEf1234567890",
    ].join("\n");
    expect(redactCredentials(safe)).toBe(safe);
  });

  it("redacts the fake server inventory while preserving its web link", () => {
    const redacted = redactCredentials(FAKE_SERVER_INVENTORY_FIXTURE);
    expect(redacted).toContain(`IP: ${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`server: ${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`SSH: deploy@${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`DB: ${HIDDEN_ADDRESS}:5432`);
    expect(redacted).toContain("Runbook: https://dadeschools.net/server-guide");
    expect(redacted).not.toContain("10.20.30.40");
    expect(redacted).not.toContain("10. 20.");
    expect(redacted).not.toContain("inventory-node.fake.internal");
    expect(redacted).not.toContain("db-node.fake.internal");
  });

  it("redacts valid IPv4 and IPv6 but leaves invalid addresses alone", () => {
    const input = [
      "Primary: 10.20.30.40",
      "IPv6: 2001:db8::42.",
      "Mapped IPv6: ::ffff:192.0.2.128",
      "Invalid: 999.20.30.40",
    ].join("\n");
    expect(redactCredentials(input)).toBe(
      [
        `Primary: ${HIDDEN_ADDRESS}`,
        `IPv6: ${HIDDEN_ADDRESS}.`,
        `Mapped IPv6: ${HIDDEN_ADDRESS}`,
        "Invalid: 999.20.30.40",
      ].join("\n"),
    );
  });

  it("redacts split IPs only with infrastructure context", () => {
    expect(redactCredentials("server: 159. 223.")).toBe(
      `server: ${HIDDEN_ADDRESS}`,
    );
    expect(redactCredentials("Sequence: 159. 223.")).toBe(
      "Sequence: 159. 223.",
    );
    expect(redactCredentials("Address: 10.20.30.40\nSequence: 159. 223.")).toBe(
      `Address: ${HIDDEN_ADDRESS}\nSequence: ${HIDDEN_ADDRESS}`,
    );
  });

  it("redacts contextual server hostnames without changing normal links", () => {
    const input = [
      "host: api-node.fake.internal",
      "server: inventory-node",
      "ssh deploy@app-node.fake.internal",
      "database: postgres://dbuser@db-node.fake.internal:5432/app",
      "cache-node.fake.local:6379",
      "localhost",
      "https://psychiatry.med.miami.edu",
      "smartersoftware.io",
      "secure.touchnet.net/central",
      "dadeschools.net",
      "eappraisal.miami.edu",
    ].join("\n");
    const redacted = redactCredentials(input);
    expect(redacted).not.toContain("api-node.fake.internal");
    expect(redacted).not.toContain("server: inventory-node");
    expect(redacted).not.toContain("app-node.fake.internal");
    expect(redacted).not.toContain("db-node.fake.internal");
    expect(redacted).not.toContain("cache-node.fake.local");
    expect(redacted).toContain(`host: ${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`server: ${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`ssh deploy@${HIDDEN_ADDRESS}`);
    expect(redacted).toContain(`@${HIDDEN_ADDRESS}:5432/app`);
    expect(redacted).toContain(`${HIDDEN_ADDRESS}:6379`);
    expect(redacted).toContain(HIDDEN_ADDRESS);
    for (const link of [
      "https://psychiatry.med.miami.edu",
      "smartersoftware.io",
      "secure.touchnet.net/central",
      "dadeschools.net",
      "eappraisal.miami.edu",
    ]) {
      expect(redacted).toContain(link);
    }
  });

  it("preserves versions, dates, times, phones, prices, and masked IDs", () => {
    const safe = [
      "Release v1.2.3.4",
      "Version: 10.20.30.40",
      "Date: 2026-10-19",
      "Time: 10:20:30",
      "Phone: 305-555-0199",
      "Price: $1,234.56",
      "Masked ID: ***-**-6789",
      "Stack: /workspace/src/redaction.test.ts:42:7",
    ].join("\n");
    expect(redactCredentials(safe)).toBe(safe);
  });

  it("keeps address placeholders safe and never learns bracketed values", () => {
    withCredentialRedactionScope(
      () => {
        const once = redactCredentials(
          "server: [hidden address]\nIPv6: [2001:db8::42]\nkey: Prefix123[not-a-secret",
        );
        expect(redactCredentials(once)).toBe(once);
        expect(once).toBe(
          `server: ${HIDDEN_ADDRESS}\nIPv6: ${HIDDEN_ADDRESS}\nkey: ${HIDDEN_CREDENTIAL}`,
        );
        expect(
          learnedAddressValues().every((value) => !value.includes("[")),
        ).toBe(true);
        expect(learnedCredentialValues()).not.toContain("Prefix123");
        redactCredentials("host: inventory-node.fake.internal");
        expect(redactCredentials("Echo INVENTORY-NODE.FAKE.INTERNAL.")).toBe(
          `Echo ${HIDDEN_ADDRESS}.`,
        );
        expect(learnedCredentialValues()).not.toContain("Seed123");
        expect(learnedAddressValues()).not.toContain("node.fake[internal");
      },
      ["Seed123[ignored"],
      ["node.fake[internal"],
    );
  });

  it("redacts sshpass and same-line SSH password tokens", () => {
    const input = "sshpass -p ShortFake! ssh root@10.20.30.40 SameLineFake!";
    const redacted = redactCredentials(input);
    expect(redacted).not.toContain("ShortFake!");
    expect(redacted).not.toContain("SameLineFake!");
  });

  it("redacts a no-host user credential greedily to the path separator", () => {
    const secret = "Abc123xyzAbc123xyz@Q@Wordtail9";
    expect(redactCredentials(`deploy user:${secret}/var/www/x`)).toContain(
      `user:${HIDDEN_CREDENTIAL}/var/www/x`,
    );
    expect(
      redactCredentials(
        `ssh root@10.20.30.40\n${secret}\ndeploy user:${secret}/var/www/x`,
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

  it("preserves a non-secret email while redacting an SSH address", () => {
    const input = "Contact user@example.com.\nssh root@10.20.30.40.";
    expect(redactCredentials(input)).toBe(
      `Contact user@example.com.\nssh root@${HIDDEN_ADDRESS}.`,
    );
  });

  it("uses the previous line as context for a bare Key label", () => {
    const secret = "QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12";
    expect(redactCredentials(`DigitalOcean Spaces\nKey: ${secret}`)).toBe(
      `DigitalOcean Spaces\nKey: ${HIDDEN_CREDENTIAL}`,
    );
  });

  it("collapses adjacent and partial redaction placeholders", () => {
    expect(
      redactCredentials("[hidden credential][hidden credential] credential]"),
    ).toBe(HIDDEN_CREDENTIAL);
    expect(redactCredentials("[hidden address][hidden address] address]")).toBe(
      HIDDEN_ADDRESS,
    );
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
      "ssh root@10.20.30.40\nAbc123xyzAbc123xyz@Q@Wordtail9";
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
      FAKE_SERVER_INVENTORY_FIXTURE,
      'key: Ab1cD2e"><Fg3Hi4Jk5Lm6No7Pq',
      "password is [hidden credential].",
      "server: [hidden address].",
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

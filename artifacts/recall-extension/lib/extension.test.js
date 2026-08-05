import { describe, expect, it } from "vitest";
import {
  APPROVED_HOSTS,
  classifyHost,
  isAllowedHost,
} from "./lib/hosts.js";
import {
  buildFingerprint,
  hasRecentFingerprint,
  pruneFingerprintHistory,
  rememberFingerprint,
  FINGERPRINT_TTL_MS,
} from "./lib/fingerprint.js";
import {
  buildCaptureBody,
  collectorFor,
  sourceLabelFor,
} from "./lib/capture-body.js";
import { MIN_BODY_CHARS, firstText, bestBodyText } from "./lib/extract.js";

describe("host allowlist", () => {
  it("allows only the documented Outlook and Teams hosts", () => {
    expect(APPROVED_HOSTS).toEqual([
      "outlook.office.com",
      "outlook.office365.com",
      "outlook.live.com",
      "teams.microsoft.com",
      "teams.live.com",
    ]);
  });

  it("accepts approved hosts and rejects everything else", () => {
    expect(isAllowedHost("outlook.office.com")).toBe(true);
    expect(isAllowedHost("mail.outlook.office.com")).toBe(true);
    expect(isAllowedHost("teams.microsoft.com")).toBe(true);
    expect(isAllowedHost("gmail.com")).toBe(false);
    expect(isAllowedHost("evil-outlook.office.com.attacker.com")).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });

  it("classifies outlook vs teams", () => {
    expect(classifyHost("outlook.live.com")).toBe("outlook");
    expect(classifyHost("teams.live.com")).toBe("teams");
    expect(classifyHost("example.com")).toBe(null);
  });
});

describe("fingerprint dedupe", () => {
  it("is stable for the same logical message", () => {
    const a = buildFingerprint({
      source: "outlook",
      url: "https://outlook.office.com/mail/id/1",
      subjectOrChat: "Permit follow-up",
      sender: "Carlos",
      messageText: "Please send the as-builts by Friday.",
    });
    const b = buildFingerprint({
      source: "outlook",
      url: "https://outlook.office.com/mail/id/1",
      subjectOrChat: "  Permit follow-up ",
      sender: "carlos",
      messageText: "Please   send the as-builts by Friday.",
    });
    expect(a).toBe(b);
  });

  it("changes when the message body changes", () => {
    const a = buildFingerprint({
      source: "teams",
      url: "https://teams.microsoft.com/l/chat/1",
      subjectOrChat: "Project",
      sender: "Ada",
      messageText: "Version one",
    });
    const b = buildFingerprint({
      source: "teams",
      url: "https://teams.microsoft.com/l/chat/1",
      subjectOrChat: "Project",
      sender: "Ada",
      messageText: "Version two",
    });
    expect(a).not.toBe(b);
  });

  it("prunes expired fingerprints and remembers recent ones", () => {
    const now = 1_000_000;
    const fp = "abc123";
    let history = rememberFingerprint([], fp, now);
    expect(hasRecentFingerprint(history, fp, now + 1000)).toBe(true);

    history = pruneFingerprintHistory(
      [{ fingerprint: fp, at: now - FINGERPRINT_TTL_MS - 1 }],
      now,
    );
    expect(history).toHaveLength(0);
    expect(hasRecentFingerprint(history, fp, now)).toBe(false);
  });
});

describe("capture body", () => {
  it("labels automatic Outlook and Teams captures distinctly", () => {
    expect(sourceLabelFor("outlook", "automatic")).toBe(
      "Outlook Web — automatic",
    );
    expect(sourceLabelFor("teams", "manual")).toBe("Teams Web");
    expect(collectorFor("outlook")).toBe("outlook_web");
  });

  it("builds an API body with captureMode and fingerprint metadata", () => {
    const body = buildCaptureBody(
      {
        source: "outlook",
        hostname: "outlook.office.com",
        url: "https://outlook.office.com/mail/id/9",
        title: "Inbox",
        subject: "Inspection",
        sender: "Vendor",
        body: "x".repeat(MIN_BODY_CHARS),
        fingerprint: "fp-1",
        timestamp: "2026-07-31T12:00:00.000Z",
      },
      "automatic",
    );

    expect(body.sourceType).toBe("browser_extension");
    expect(body.sourceName).toBe("Outlook Web — automatic");
    expect(body.sourceUrl).toContain("outlook.office.com");
    expect(body.rawMetadata.captureMode).toBe("automatic");
    expect(body.rawMetadata.collector).toBe("outlook_web");
    expect(body.rawMetadata.fingerprint).toBe("fp-1");
    expect(body.rawText).toContain("Inspection");
    expect(body.rawText).toContain("Vendor");
  });
});

describe("extract helpers", () => {
  it("reads the first non-empty selector match", () => {
    const doc = {
      querySelectorAll(sel) {
        if (sel === ".empty") return [{ textContent: "  " }];
        if (sel === ".hit") return [{ textContent: " Hello " }];
        return [];
      },
    };
    expect(firstText(doc, [".empty", ".hit"])).toBe("Hello");
  });

  it("prefers the longest body region", () => {
    const doc = {
      querySelectorAll(sel) {
        if (sel === ".short") return [{ innerText: "short" }];
        if (sel === ".long") return [{ innerText: "a".repeat(120) }];
        return [];
      },
    };
    expect(bestBodyText(doc, [".short", ".long"]).length).toBe(120);
  });
});

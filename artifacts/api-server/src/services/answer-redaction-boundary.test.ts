import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildAskAnswerMetadata } from "./ask-answer-metadata";
import { sanitizeAskMessageForStorage } from "./ask-threads";
import { sanitizeAuditMetadata } from "./audit";

describe("answer persistence and citation redaction", () => {
  it("redacts stored answer text and UI citation snippets", () => {
    const secret = "FakePsychiatryPassword!42";
    const highEntropy =
      "QWxhZGRpbjpPcGVuU2VzYW1lMTIzNDU2Nzg5MDEAB12";
    const stored = sanitizeAskMessageForStorage({
      content: `SSH password: ${secret}\nEchoed ${highEntropy}`,
      metadata: {
        reasoning: `pwd: ${secret}`,
      },
    });
    const metadata = buildAskAnswerMetadata({
      confidence: 0.9,
      caveats: `password: ${secret}`,
      relatedRecords: [
        {
          entityType: "note",
          entityId: "psychiatry-inventory",
          title: "Psychiatry Inventory App",
        },
      ],
      evidence: [
        {
          id: "e1",
          entityType: "note",
          entityId: "psychiatry-inventory",
          claimType: "source_excerpt",
          sourceCaptureId: null,
          sourceRecordId: null,
          evidenceText: `Spaces secret key: ${secret}`,
          evidenceMetadata: { context: `Bearer ${secret}` },
          fileName: null,
          fileId: null,
          rowNumber: null,
          pageNumber: null,
          url: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
      images: [],
      privacy: {
        model: "gpt-test",
        dataLeftDevice: true,
        categoriesSent: ["note"],
      },
      suggestedNextAction: null,
      promptVersion: "test",
      degraded: false,
    });

    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(highEntropy);
    expect(JSON.stringify(metadata)).not.toContain(secret);
    expect(JSON.stringify(metadata)).toContain("[hidden credential]");
    expect(
      JSON.stringify(
        sanitizeAuditMetadata({
          question: `What is password: ${secret}`,
          answer: `Echoed ${highEntropy}`,
        }),
      ),
    ).not.toContain(secret);
    expect(
      JSON.stringify(
        sanitizeAuditMetadata({ answer: `Echoed ${highEntropy}` }),
      ),
    ).not.toContain(highEntropy);
  });

  it("does not redact the raw note read service used by open-note/show-me", async () => {
    const notesSource = await readFile(
      new URL("./notes.ts", import.meta.url),
      "utf8",
    );
    expect(notesSource).not.toContain("secret-redaction");
    expect(notesSource).not.toContain("redactCredentials");
  });

  it("handles text credential asks before allowance or model synthesis", async () => {
    const querySource = await readFile(
      new URL("./query-engine.ts", import.meta.url),
      "utf8",
    );
    const credentialBoundary = querySource.indexOf(
      "if (isCredentialRequest(question))",
    );
    expect(credentialBoundary).toBeGreaterThan(0);
    expect(credentialBoundary).toBeLessThan(
      querySource.indexOf('userAiAllowance("ask_query"'),
    );
    expect(querySource).toContain(
      "credentialReferenceAnswer(credentialRecord.title)",
    );
  });
});

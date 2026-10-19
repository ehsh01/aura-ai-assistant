import { describe, expect, it } from "vitest";
import { gmailAttachments } from "./google";

describe("Gmail attachment metadata", () => {
  it("collects nested attachment ids without treating the message body as a file", () => {
    expect(
      gmailAttachments({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: "SGVsbG8" },
          },
          {
            mimeType: "application/pdf",
            filename: "roof-contract.pdf",
            body: { attachmentId: "attachment-1", size: 1234 },
          },
        ],
      }),
    ).toEqual([
      {
        id: "attachment-1",
        fileName: "roof-contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    ]);
  });
});

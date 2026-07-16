import { describe, expect, it } from "vitest";
import { buildAskAnswerMetadata } from "./ask-answer-metadata";

describe("buildAskAnswerMetadata", () => {
  it("preserves evidence snapshots and answer provenance for thread reload", () => {
    const evidence = {
      id: "ev-1",
      entityType: "note",
      entityId: "note-1",
      claimType: "summary_based_on",
      sourceCaptureId: null,
      sourceRecordId: null,
      evidenceText: "VIN WP0ZZZ99ZTS392124",
      evidenceMetadata: { retrievalMethod: "hybrid" },
      fileName: "scan.jpg",
      fileId: null,
      rowNumber: null,
      pageNumber: null,
      url: null,
      createdAt: "2026-07-12T20:00:00.000Z",
      updatedAt: "2026-07-12T20:00:00.000Z",
    };

    const metadata = buildAskAnswerMetadata({
      confidence: 0.91,
      caveats: null,
      relatedRecords: [
        { entityType: "note", entityId: "note-1", title: "Porsche paperwork" },
      ],
      evidence: [evidence],
      images: [
        {
          attachmentId: "att-1",
          noteId: "note-1",
          noteTitle: "Porsche paperwork",
          fileName: "scan.jpg",
          mimeType: "image/jpeg",
        },
      ],
      privacy: {
        model: "gpt-4o-mini",
        dataLeftDevice: true,
        categoriesSent: ["note"],
      },
      suggestedNextAction: "Open the note",
      promptVersion: "query-answer.v1",
      degraded: false,
    });

    expect(metadata.evidence).toEqual([evidence]);
    expect(metadata.images).toHaveLength(1);
    expect(metadata.privacy.categoriesSent).toEqual(["note"]);
    expect(metadata.suggestedNextAction).toBe("Open the note");
    expect(metadata.promptVersion).toBe("query-answer.v1");
  });

  it("caps related records without dropping evidence", () => {
    const relatedRecords = Array.from({ length: 12 }, (_, index) => ({
      entityType: "note",
      entityId: `note-${index}`,
      title: `Note ${index}`,
    }));
    const metadata = buildAskAnswerMetadata({
      confidence: 0.5,
      caveats: "Review sources",
      relatedRecords,
      evidence: [],
      images: [],
      privacy: { model: null, dataLeftDevice: false, categoriesSent: [] },
      suggestedNextAction: null,
      promptVersion: "query-answer.v1",
      degraded: true,
    });

    expect(metadata.relatedRecords).toHaveLength(8);
  });
});

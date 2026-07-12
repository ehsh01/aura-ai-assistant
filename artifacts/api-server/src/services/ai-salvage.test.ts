import { describe, expect, it } from "vitest";
import { salvageAnswerField } from "./ai";

describe("salvageAnswerField", () => {
  it("recovers the answer from truncated JSON (evidence list cut off)", () => {
    const truncated =
      '{\n  "answer": "You have 24 PDF contracts in your Google Drive.",\n  "confidence": 1,\n  "evidenceRefs": [\n    { "entityType": "source_record", "entityId": "gdrive:1I95FVN';
    expect(salvageAnswerField(truncated)).toBe(
      "You have 24 PDF contracts in your Google Drive.",
    );
  });

  it("decodes escaped quotes and newlines in the answer", () => {
    const raw = '{"answer":"The file is \\"779 Survey\\".\\nModified in May.","confidence":0.8';
    expect(salvageAnswerField(raw)).toBe('The file is "779 Survey".\nModified in May.');
  });

  it("returns null when there is no answer field", () => {
    expect(salvageAnswerField("total gibberish with no json")).toBeNull();
    expect(salvageAnswerField("{ \"confidence\": 0.5 }")).toBeNull();
  });

  it("rejects a salvaged value that is itself a JSON blob", () => {
    expect(salvageAnswerField('{"answer":"{\\"nested\\":true}","confidence":1}')).toBeNull();
  });
});

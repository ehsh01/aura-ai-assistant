import { describe, expect, it } from "vitest";
import { keywordScore } from "./retrieval";
import { noteRetrievalText } from "./note-retrieval";

describe("noteRetrievalText", () => {
  it("makes attachment-only OCR text searchable by Ask", () => {
    const text = noteRetrievalText({
      title: "Porsche paperwork",
      content: "Vehicle records",
      tags: ["car"],
      attachmentText: "scan.jpg\nVIN WP0ZZZ99ZTS392124",
    });

    expect(text).toContain("VIN WP0ZZZ99ZTS392124");
    expect(keywordScore("WP0ZZZ99ZTS392124", text)).toBeGreaterThan(0);
  });

  it("uses full note content instead of only the short preview", () => {
    const text = noteRetrievalText({
      title: "Inspection",
      preview: "Short preview",
      content: "Short preview followed by the unique permit code BLDG-84729.",
      tags: [],
    });

    expect(text).toContain("BLDG-84729");
  });
});

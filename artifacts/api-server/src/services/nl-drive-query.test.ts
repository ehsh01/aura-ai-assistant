import { describe, expect, it } from "vitest";
import {
  extractDriveDateConstraint,
  isDriveSearchIntent,
  planDriveSearchHeuristic,
  planDriveSearchKeywords,
} from "./nl-drive-query";

describe("isDriveSearchIntent", () => {
  it("detects document/file asks", () => {
    expect(isDriveSearchIntent("find the contract for 779 NW 41 ST")).toBe(true);
    expect(isDriveSearchIntent("search my drive for pdfs")).toBe(true);
    expect(isDriveSearchIntent("show me the permit documents")).toBe(true);
    expect(isDriveSearchIntent("any spreadsheets about payments")).toBe(true);
  });

  it("ignores unrelated asks", () => {
    expect(isDriveSearchIntent("How much did I spend?")).toBe(false);
    expect(isDriveSearchIntent("what is my wife's name")).toBe(false);
  });
});

describe("extractDriveDateConstraint", () => {
  it("maps relative dates to modifiedTime", () => {
    expect(extractDriveDateConstraint("last week")).toMatch(
      /^modifiedTime > '20\d\d-\d\d-\d\dT/,
    );
  });

  it("maps a named day to a bounded range", () => {
    const c = extractDriveDateConstraint("on Apr 23, 2026");
    expect(c).toContain("modifiedTime >= '2026-04-23T00:00:00Z'");
    expect(c).toContain("modifiedTime < '2026-04-24T00:00:00Z'");
  });
});

describe("planDriveSearchHeuristic", () => {
  it("builds fullText + name content clause and always excludes trashed", () => {
    const planned = planDriveSearchHeuristic("find documents about the permit extension");
    expect(planned).not.toBeNull();
    expect(planned!.query).toContain("fullText contains 'permit extension'");
    expect(planned!.query).toContain("name contains 'permit extension'");
    expect(planned!.query).toContain("trashed = false");
  });

  it("adds a mimeType filter when a PDF is requested", () => {
    const planned = planDriveSearchHeuristic("find the contract pdf for 779");
    expect(planned).not.toBeNull();
    expect(planned!.query).toContain("mimeType = 'application/pdf'");
    expect(planned!.fileType).toBe("pdf");
  });

  it("matches document-kind words like contract as content", () => {
    const planned = planDriveSearchHeuristic("do I have a contract in my drive");
    expect(planned).not.toBeNull();
    expect(planned!.query.toLowerCase()).toContain("contains 'contract'");
  });

  it("escapes single quotes in values", () => {
    const planned = planDriveSearchHeuristic("find the document about O'Brien");
    expect(planned).not.toBeNull();
    expect(planned!.query).toContain("O\\'Brien");
  });
});

describe("planDriveSearchKeywords", () => {
  it("falls back to keyword content when phrasing is messy", () => {
    const planned = planDriveSearchKeywords("please pull up files for 779 NW 41 ST");
    expect(planned).not.toBeNull();
    expect(planned!.query.toLowerCase()).toContain("779 nw 41 st");
    expect(planned!.query).toContain("trashed = false");
  });
});

import { describe, expect, it } from "vitest";
import { suggestDocumentFiling } from "./document-filing";

describe("suggestDocumentFiling", () => {
  it("detects invoices and warranties", () => {
    expect(suggestDocumentFiling("Invoice #4412 amount due $80")?.kind).toBe("invoice");
    expect(suggestDocumentFiling("Limited warranty covered until 2028")?.kind).toBe("warranty");
  });

  it("ignores short or unrelated text", () => {
    expect(suggestDocumentFiling("hi")).toBeNull();
    expect(suggestDocumentFiling("Meeting notes from Tuesday")).toBeNull();
  });
});

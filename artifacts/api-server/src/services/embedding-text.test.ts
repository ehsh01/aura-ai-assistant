import { describe, expect, it } from "vitest";
import {
  embeddingTextForContextRecord,
  memoryEmbeddingText,
  personEmbeddingText,
} from "./embedding-text";
import { heuristicDigest, heuristicFactBullets } from "./digests";
import { promptTextForRetrievedRecord } from "./prompt-context";

describe("embedding-text stability", () => {
  it("builds identical memory text for warm and Ask corpus", () => {
    const a = memoryEmbeddingText({
      domain: "family",
      title: "Spouse",
      content: "Married to Alex since 2012",
      tags: ["family"],
      primaryPersonId: "p1",
      personName: "Alex",
      pinned: true,
    });
    const b = memoryEmbeddingText({
      domain: "family",
      title: "Spouse",
      content: "Married to Alex since 2012",
      tags: ["family"],
      primaryPersonId: "p1",
      personName: "Alex",
      pinned: true,
    });
    expect(a).toBe(b);
    expect(a).toContain("personId=p1");
    expect(a).toContain("pinned=true");
  });

  it("does not double-prefix title when text already includes it", () => {
    const noteText = "Front door code\n1234\ntags=home";
    expect(
      embeddingTextForContextRecord({
        entityType: "note",
        title: "Front door code",
        text: noteText,
      }),
    ).toBe(noteText);
  });

  it("prefers digest for compact embed text", () => {
    expect(
      embeddingTextForContextRecord({
        entityType: "note",
        title: "Long note",
        text: "Long note\n" + "x".repeat(3000),
        digest: "Door code is 1234",
      }),
    ).toBe("Long note\nDoor code is 1234");
  });

  it("matches person warm to Ask corpus fields", () => {
    const text = personEmbeddingText({
      displayName: "Alex Rivera",
      firstName: "Alex",
      lastName: "Rivera",
      email: "a@example.com",
      organization: "Acme",
    });
    expect(text).toContain("fullName=Alex Rivera");
    expect(text).toContain("email=a@example.com");
    expect(text).toContain("organization=Acme");
  });
});

describe("digests", () => {
  it("builds a short heuristic digest", () => {
    const d = heuristicDigest(
      "Title",
      "First sentence is useful. Second sentence also helps. Third.",
      80,
    );
    expect(d.length).toBeLessThanOrEqual(80);
    expect(d).toContain("First sentence");
  });

  it("extracts fact bullets", () => {
    const bullets = heuristicFactBullets(
      "- VIN is 1HGCM82633A004352\n- Insurance expires 2027-01-01\n",
    );
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.some((b) => /VIN/i.test(b))).toBe(true);
  });
});

describe("prompt-context digest-first", () => {
  it("uses digest for lower-ranked records", () => {
    const text = promptTextForRetrievedRecord(
      {
        entityType: "note",
        title: "Note",
        text: "Note\n" + "full body ".repeat(100),
        digest: "Short fact",
      },
      { question: "what do I know?", rankIndex: 5, emailIntent: false },
    );
    expect(text).toBe("Note\nShort fact");
  });

  it("expands top hits and exact-ID questions", () => {
    const full = "Note\nVIN is ABC";
    expect(
      promptTextForRetrievedRecord(
        {
          entityType: "note",
          title: "Note",
          text: full,
          digest: "Short",
        },
        { question: "what is the VIN?", rankIndex: 5, emailIntent: false },
      ),
    ).toBe(full);
  });
});

import { describe, expect, it } from "vitest";
import {
  annotatePrimaryExternalLink,
  compactSuggestedNextAction,
  primaryLinkLabelForUrl,
} from "./ask-compact-ui";

describe("compactSuggestedNextAction", () => {
  it("keeps clarify reply hints", () => {
    expect(compactSuggestedNextAction('Reply “yesterday”')).toBe('Reply “yesterday”');
  });

  it("drops success follow-ups like breakdown", () => {
    expect(
      compactSuggestedNextAction("Ask for a breakdown to see every transaction", {
        confidence: 0.95,
        answer: "You spent $12.00",
      }),
    ).toBeNull();
  });

  it("keeps connector CTAs on missing setup", () => {
    expect(
      compactSuggestedNextAction("Open Connectors → Google", {
        confidence: 0.35,
        answer: "I can't search email until a Google account is connected.",
        caveats: "Gmail not connected.",
      }),
    ).toBe("Open Connectors → Google");
  });

  it("drops Open Connectors on successful finance breakdown", () => {
    expect(
      compactSuggestedNextAction("Open Connectors → Finance", {
        confidence: 0.95,
        answer: "You spent $40 across 3 transaction(s)",
      }),
    ).toBeNull();
  });
});

describe("annotatePrimaryExternalLink", () => {
  it("labels the first https evidence URL", () => {
    const out = annotatePrimaryExternalLink([
      { evidenceMetadata: { foo: 1 } as Record<string, unknown> },
      {
        evidenceMetadata: {
          sourceUrl: "https://mail.google.com/mail/?authuser=a@b.com#inbox/abc",
        } as Record<string, unknown>,
      },
    ]);
    expect(out[1]!.evidenceMetadata.primaryLinkLabel).toBe("Open in Gmail");
    expect(primaryLinkLabelForUrl("https://drive.google.com/file/d/1")).toBe(
      "Open in Drive",
    );
  });
});

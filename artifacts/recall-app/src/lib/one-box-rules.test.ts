import { describe, expect, it } from "vitest";
import {
  classifyOneBoxInput,
  isBareUrl,
  isShowMeFollowUp,
  voiceAnswerForSpeech,
  voicePresentationFor,
} from "./one-box-rules";

describe("Recall one-box deterministic routing", () => {
  it.each([
    [
      "save the gate code is 4471",
      "save",
      "save-verb",
      "the gate code is 4471",
    ],
    ["remember pool guy is Carlos", "save", "save-verb", "pool guy is Carlos"],
    [
      "note: insurance policy renewed",
      "save",
      "save-verb",
      "insurance policy renewed",
    ],
    [
      "keep this paint color for the kitchen",
      "save",
      "save-verb",
      "this paint color for the kitchen",
    ],
    [
      "add the plumber's number to my notes",
      "save",
      "save-verb",
      "the plumber's number to my notes",
    ],
    ["find the roof invoice", "search", "search-verb", "the roof invoice"],
    ["look up the roof invoice", "search", "search-verb", "the roof invoice"],
    [
      "search warranty expiration",
      "search",
      "search-verb",
      "warranty expiration",
    ],
    [
      "show last month's receipts",
      "search",
      "search-verb",
      "last month's receipts",
    ],
    [
      "https://example.com/roof",
      "save",
      "bare-url",
      "https://example.com/roof",
    ],
    ["Carlos phone?", "search", "question-mark", "Carlos phone?"],
    [
      "when does my roof warranty expire",
      "search",
      "question-word",
      "when does my roof warranty expire",
    ],
    [
      "who installed the roof",
      "search",
      "question-word",
      "who installed the roof",
    ],
    ["roof warranty", "search", "short", "roof warranty"],
    ["Carlos", "search", "short", "Carlos"],
    [
      "Gate code for mom's building changed to 4471 on Oct 18",
      "save",
      "statement",
      "Gate code for mom's building changed to 4471 on Oct 18",
    ],
  ] as const)("routes %j as %s", (value, intent, reason, normalized) => {
    expect(classifyOneBoxInput({ value })).toEqual({
      intent,
      reason,
      value: normalized,
    });
  });

  it("uses first-match precedence", () => {
    expect(
      classifyOneBoxInput({
        value: "find this?",
        hasAttachment: true,
      }),
    ).toMatchObject({ intent: "save", reason: "attachment" });
    expect(
      classifyOneBoxInput({ value: "remember where is it?" }),
    ).toMatchObject({
      intent: "save",
      reason: "save-verb",
    });
    expect(
      classifyOneBoxInput({ value: "show https://example.com" }),
    ).toMatchObject({
      intent: "search",
      reason: "search-verb",
    });
  });

  it("honors explicit overrides", () => {
    expect(
      classifyOneBoxInput({ value: "find the permit", forceSave: true }),
    ).toMatchObject({ intent: "save", reason: "forced-save" });
    expect(classifyOneBoxInput({ value: "? remember the permit" })).toEqual({
      intent: "search",
      reason: "forced-search",
      value: "remember the permit",
    });
  });

  it("ignores the Recall wake name for voice routing", () => {
    expect(
      classifyOneBoxInput({
        value: "Recall, remember that the gate code is 4471",
        voice: true,
      }),
    ).toMatchObject({
      intent: "save",
      value: "that the gate code is 4471",
    });
  });

  it("recognizes only complete bare HTTP(S) URLs", () => {
    expect(isBareUrl("https://example.com/a?b=1")).toBe(true);
    expect(isBareUrl("see https://example.com")).toBe(false);
    expect(isBareUrl("file:///tmp/a")).toBe(false);
  });
});

describe("voice presentation rules", () => {
  it.each(["show me", "show it", "let me see", "Recall, show me!"])(
    "matches the show-me follow-up %j",
    (value) => expect(isShowMeFollowUp(value)).toBe(true),
  );

  it.each(["show the permit", "can I see it", "show me the file"])(
    "does not over-match %j",
    (value) => expect(isShowMeFollowUp(value)).toBe(false),
  );

  it("promotes the best document or an explicit document query", () => {
    expect(
      voicePresentationFor({
        query: "when was it signed",
        bestIsDocument: true,
      }),
    ).toBe("document");
    expect(
      voicePresentationFor({
        query: "show the contract",
        bestIsDocument: false,
      }),
    ).toBe("document");
  });

  it("keeps dates, numbers and tags compact without cards", () => {
    expect(
      voicePresentationFor({
        query: "when does it expire",
        bestIsDocument: false,
        answer: "It expires on October 18, 2027.",
      }),
    ).toBe("fact");
    expect(
      voicePresentationFor({
        query: "what was the total",
        bestIsDocument: false,
        answer: "The total was $1,284.22.",
      }),
    ).toBe("fact");
    expect(
      voicePresentationFor({
        query: "which tag",
        bestIsDocument: false,
        answer: "It is tagged as warranty.",
      }),
    ).toBe("fact");
  });

  it("offers cards for a non-fact narrative answer", () => {
    expect(
      voicePresentationFor({
        query: "tell me about the repair",
        bestIsDocument: false,
        answer: "The roofer replaced the damaged section.",
      }),
    ).toBe("cards");
  });

  it("adds one short show-me prompt to the same document answer", () => {
    expect(
      voiceAnswerForSpeech("I found your roof contract.", "document"),
    ).toBe(
      'I found your roof contract. I found the document; say "show me" to open it.',
    );
    expect(
      voiceAnswerForSpeech(
        'I found it. Say "show me" to open the document.',
        "document",
      ),
    ).toBe('I found it. Say "show me" to open the document.');
    expect(voiceAnswerForSpeech("It expires tomorrow.", "fact")).toBe(
      "It expires tomorrow.",
    );
  });
});

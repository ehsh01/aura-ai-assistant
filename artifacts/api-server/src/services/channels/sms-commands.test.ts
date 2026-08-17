import { describe, expect, it } from "vitest";
import { compactSmsAnswer, parseSmsCommand } from "./sms-commands";

describe("parseSmsCommand", () => {
  it("confirms common yes replies", () => {
    expect(parseSmsCommand("yes")).toEqual({ kind: "confirm" });
    expect(parseSmsCommand("OK")).toEqual({ kind: "confirm" });
  });

  it("cancels common no replies", () => {
    expect(parseSmsCommand("no")).toEqual({ kind: "cancel" });
    expect(parseSmsCommand("never mind")).toEqual({ kind: "cancel" });
  });

  it("marks done", () => {
    expect(parseSmsCommand("done")).toEqual({ kind: "done" });
  });

  it("parses snooze presets", () => {
    expect(parseSmsCommand("snooze")).toMatchObject({ kind: "snooze", preset: "3d" });
    expect(parseSmsCommand("snooze tomorrow")).toMatchObject({ kind: "snooze", preset: "1d" });
    expect(parseSmsCommand("snooze for a week")).toMatchObject({ kind: "snooze", preset: "1w" });
  });

  it("parses remember and free text", () => {
    expect(parseSmsCommand("remember: the reviewer is Marisol")).toEqual({
      kind: "remember",
      text: "the reviewer is Marisol",
    });
    expect(parseSmsCommand("What am I waiting on?")).toEqual({
      kind: "free_text",
      text: "What am I waiting on?",
    });
  });
});

describe("compactSmsAnswer", () => {
  it("truncates long answers", () => {
    const long = "x".repeat(400);
    expect(compactSmsAnswer(long, 20).endsWith("…")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { extractPerson, mergeWaitingOnLists, type WaitingOnItem } from "./waiting-on";

describe("extractPerson (waiting-on)", () => {
  it("does not swallow the next sentence word after a name", () => {
    expect(
      extractPerson("Waiting on quote from Mike Still need the drywall quote", []),
    ).toBe("Mike");
  });

  it("keeps two-word names when both look like names", () => {
    expect(extractPerson("waiting on reply from Jane Doe about the permit", [])).toBe(
      "Jane Doe",
    );
  });

  it("prefers known people names", () => {
    expect(
      extractPerson("Still need the quote from Mike", ["Mike Hernandez"]),
    ).toBe("Mike Hernandez");
  });

  it("extracts the person after Call/Email verbs", () => {
    expect(extractPerson("Call Mike about the quote", [])).toBe("Mike");
  });

  it("ignores imperative verbs without a person", () => {
    expect(extractPerson("Buy groceries", [])).toBe("Someone");
  });
});

function row(id: string, days: number, sourceType: WaitingOnItem["sourceType"] = "mail"): WaitingOnItem {
  return {
    id,
    person: "Carlos",
    personId: null,
    item: `Item ${id}`,
    days,
    href: `/waiting/${id}`,
    followUp: "Follow up with Carlos",
    sourceType,
    evidenceText: "",
  };
}

describe("mergeWaitingOnLists", () => {
  it("puts durable commitments ahead of heuristic rows", () => {
    const merged = mergeWaitingOnLists({
      durable: [row("durable:w1", 0, "durable")],
      heuristic: [row("mail:sr-9", 5), row("note:n1", 3, "note")],
      dismissedIds: new Set(),
      suppressHeuristicIds: new Set(),
      limit: 20,
    });
    expect(merged.map((m) => m.id)).toEqual(["durable:w1", "mail:sr-9", "note:n1"]);
  });

  it("suppresses heuristic rows whose source is already tracked", () => {
    const merged = mergeWaitingOnLists({
      durable: [row("durable:w1", 2, "durable")],
      heuristic: [row("mail:sr-1", 5), row("mail:sr-2", 4)],
      dismissedIds: new Set(),
      suppressHeuristicIds: new Set(["mail:sr-1"]),
      limit: 20,
    });
    expect(merged.map((m) => m.id)).toEqual(["durable:w1", "mail:sr-2"]);
  });

  it("honors dismissals for both durable and heuristic rows", () => {
    const merged = mergeWaitingOnLists({
      durable: [row("durable:w1", 2, "durable")],
      heuristic: [row("mail:sr-1", 5)],
      dismissedIds: new Set(["durable:w1"]),
      suppressHeuristicIds: new Set(),
      limit: 20,
    });
    expect(merged.map((m) => m.id)).toEqual(["mail:sr-1"]);
  });

  it("respects the limit", () => {
    const merged = mergeWaitingOnLists({
      durable: [row("durable:w1", 1, "durable"), row("durable:w2", 2, "durable")],
      heuristic: [row("mail:sr-1", 5)],
      dismissedIds: new Set(),
      suppressHeuristicIds: new Set(),
      limit: 2,
    });
    expect(merged).toHaveLength(2);
    expect(merged[0]?.sourceType).toBe("durable");
  });
});

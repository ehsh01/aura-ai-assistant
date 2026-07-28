import { describe, expect, it } from "vitest";
import {
  decideCaptureWaitingGate,
  decideNoteWaitingCandidate,
  decideTaskWaitingCandidate,
  hasWaitingStatement,
} from "./waiting-candidates";

describe("hasWaitingStatement (user-authored follow-up language)", () => {
  it("matches waiting statements", () => {
    expect(hasWaitingStatement("Waiting on Carlos for the inspection confirmation")).toBe(true);
    expect(hasWaitingStatement("They will send the signed contract Monday")).toBe(true);
    expect(hasWaitingStatement("I need to hear back from the attorney")).toBe(true);
    expect(hasWaitingStatement("Still waiting on the city revision")).toBe(true);
    expect(hasWaitingStatement("Follow up with the vendor next week")).toBe(true);
  });

  it("ignores ordinary prose", () => {
    expect(hasWaitingStatement("Picked up groceries and called mom")).toBe(false);
    expect(hasWaitingStatement("Meeting notes from Tuesday")).toBe(false);
  });
});

describe("decideCaptureWaitingGate (capture → waiting model)", () => {
  it("high-confidence follow_up with a named owner opens directly", () => {
    const gate = decideCaptureWaitingGate({
      types: ["follow_up"],
      confidence: 0.9,
      rawText: "Carlos said he will send the permit Monday",
      ownerName: "Carlos",
    });
    expect(gate?.status).toBe("open");
    expect(gate?.ownerName).toBe("Carlos");
    expect(gate?.reason).toBeNull();
  });

  it("follow_up without confidence or a name becomes a review candidate", () => {
    const noName = decideCaptureWaitingGate({
      types: ["follow_up"],
      confidence: 0.9,
      rawText: "they will send it",
      ownerName: null,
    });
    expect(noName?.status).toBe("candidate");
    expect(noName?.ownerName).toBe("Someone");

    const lowConf = decideCaptureWaitingGate({
      types: ["follow_up"],
      confidence: 0.6,
      rawText: "Carlos will send it",
      ownerName: "Carlos",
    });
    expect(lowConf?.status).toBe("candidate");
    expect(lowConf?.reason).toMatch(/confirm/i);
  });

  it("waiting language without a follow_up type still becomes a candidate", () => {
    const gate = decideCaptureWaitingGate({
      types: ["note"],
      confidence: 0.5,
      rawText: "Waiting on Maria for the inspection photos",
      ownerName: "Maria",
    });
    expect(gate?.status).toBe("candidate");
    expect(gate?.reason).toMatch(/waiting/i);
  });

  it("unrelated captures produce nothing", () => {
    expect(
      decideCaptureWaitingGate({
        types: ["note"],
        confidence: 0.9,
        rawText: "Recipe for arroz con pollo",
        ownerName: null,
      }),
    ).toBeNull();
  });
});

describe("decideNoteWaitingCandidate", () => {
  it("maps a waiting note to a candidate with a reason", () => {
    const out = decideNoteWaitingCandidate({
      title: "Carlos — permits",
      content: "Still waiting on the as-built documents",
      personName: "Carlos",
      ageDays: 4,
    });
    expect(out?.ownerName).toBe("Carlos");
    expect(out?.deliverable).toBe("Carlos — permits");
    expect(out?.reason).toMatch(/4d ago/);
  });

  it("falls back to Someone when no person is found", () => {
    const out = decideNoteWaitingCandidate({
      title: "Permits",
      content: "Waiting on the as-built documents",
      personName: null,
      ageDays: 0,
    });
    expect(out?.ownerName).toBe("Someone");
  });

  it("notes without waiting language produce nothing", () => {
    expect(
      decideNoteWaitingCandidate({
        title: "Trip ideas",
        content: "Bimini in September maybe",
        personName: null,
        ageDays: 10,
      }),
    ).toBeNull();
  });
});

describe("decideTaskWaitingCandidate", () => {
  it("open tasks with waiting language become candidates", () => {
    const out = decideTaskWaitingCandidate({
      title: "Waiting on vendor for revised quote",
      requesterName: "Carlos",
      personName: null,
      ageDays: 5,
    });
    expect(out?.ownerName).toBe("Carlos");
    expect(out?.reason).toMatch(/task mentions waiting/i);
  });

  it("a bare requester link never creates a candidate (no guessing)", () => {
    expect(
      decideTaskWaitingCandidate({
        title: "Renew vehicle registration",
        requesterName: "Carlos",
        personName: null,
        ageDays: 30,
      }),
    ).toBeNull();
  });
});

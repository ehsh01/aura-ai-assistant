import { describe, expect, it } from "vitest";
import {
  extractWarrantyHint,
  findProjectChangeSignals,
  findRecurringPayees,
} from "./proactive-insights";
import type { RecallNoteMetadataDto } from "./notes";
import type { RecallProjectDto } from "./projects";
import type { RecallTaskDto } from "./tasks";

describe("proactive insights helpers", () => {
  it("finds recurring payees in the lookback window", () => {
    const txs = [
      { payee: "Netflix", date: "2026-07-01", amount: -15.99 },
      { payee: "Netflix", date: "2026-06-01", amount: -15.99 },
      { payee: "Netflix", date: "2026-05-01", amount: -15.99 },
      { payee: "Coffee Spot", date: "2026-07-10", amount: -4.5 },
    ];
    expect(findRecurringPayees(txs, { minCount: 3, lookbackDays: 120 })).toEqual([
      expect.objectContaining({ payee: "Netflix", count: 3 }),
    ]);
  });

  it("requires a date token for warranty hints", () => {
    expect(extractWarrantyHint("Roof warranty", "covers leaks")).toBeNull();
    expect(extractWarrantyHint("Roof warranty", "Valid until Dec 15, 2027")).toEqual({
      summary: "Roof warranty",
      dateToken: "Dec 15, 2027",
    });
  });

  it("surfaces projects with recent notes and open tasks", () => {
    const recent = new Date().toISOString();
    const projects: RecallProjectDto[] = [
      {
        id: "p1",
        name: "New House",
        description: null,
        status: "active",
        relatedPeople: [],
        noteCount: 2,
        taskCount: 3,
        captureCount: 0,
        attachmentCount: 0,
        createdAt: recent,
        updatedAt: recent,
      },
    ];
    const notes: RecallNoteMetadataDto[] = [
      {
        id: "n1",
        title: "Permit",
        preview: "submitted",
        summary: null,
        factBullets: [],
        contentFormat: "plain",
        tags: [],
        date: "today",
        pinned: false,
        notebookId: null,
        projectId: "p1",
        primaryPersonId: null,
        primaryPersonName: null,
        attachmentCount: 0,
        createdAt: recent,
        updatedAt: recent,
      },
    ];
    const tasks: RecallTaskDto[] = [
      {
        id: "t1",
        title: "Call contractor",
        priority: "med",
        completed: false,
        projectId: "p1",
        requesterPersonId: null,
        requesterPersonName: null,
        createdAt: recent,
        updatedAt: recent,
      },
      {
        id: "t2",
        title: "Pay deposit",
        priority: "high",
        completed: false,
        projectId: "p1",
        requesterPersonId: null,
        requesterPersonName: null,
        createdAt: recent,
        updatedAt: recent,
      },
    ];
    const signals = findProjectChangeSignals(projects, notes, tasks);
    expect(signals[0]).toEqual(
      expect.objectContaining({ projectId: "p1", noteCount: 1, openTasks: 2 }),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  calculateEvernoteReport,
  evernoteAttachmentFailureTransition,
  interruptedAttachmentResetOutcome,
  isAllowedEvernoteAttachmentUrl,
  shouldResetEvernoteAttachmentFailure,
} from "./evernote-full-sync";
import {
  evernoteScheduleDecision,
  scheduledEvernoteLoadIsSafe,
} from "./evernote-sync-scheduler";
import { processEvernoteSyncJob } from "./connectors";

describe("Evernote completeness report", () => {
  it("calculates per-notebook and total missing counts", () => {
    const report = calculateEvernoteReport([
      {
        id: "one",
        notebook: "One",
        stack: null,
        spaceId: null,
        evernoteNotes: 4,
        recallNotes: 4,
        attachmentsExpected: 2,
        attachmentsStored: 2,
        tasksExpected: 1,
        tasksStored: 1,
      },
      {
        id: "two",
        notebook: "Two",
        stack: "Archive",
        spaceId: "space",
        evernoteNotes: 3,
        recallNotes: 2,
        attachmentsExpected: 1,
        attachmentsStored: 0,
        tasksExpected: 0,
        tasksStored: 0,
      },
    ]);
    expect(report.notebooks.map((item) => item.missing)).toEqual([0, 1]);
    expect(report.totals).toMatchObject({
      evernoteNotes: 7,
      recallNotes: 6,
      missing: 1,
      attachmentsExpected: 3,
      attachmentsStored: 2,
    });
    expect(report.pass).toBe(false);
  });

  it("passes only at zero missing with complete attachments and tasks", () => {
    const report = calculateEvernoteReport([
      {
        id: "complete",
        notebook: "Complete",
        stack: null,
        spaceId: null,
        evernoteNotes: 2,
        recallNotes: 2,
        attachmentsExpected: 3,
        attachmentsStored: 3,
        tasksExpected: 2,
        tasksStored: 2,
      },
    ]);
    expect(report.pass).toBe(true);
    expect(report.totals.missing).toBe(0);
  });
});

describe("Evernote attachment URL boundary", () => {
  it("allows signed storage hosts and blocks internal redirect targets", () => {
    expect(
      isAllowedEvernoteAttachmentUrl("https://storage.googleapis.com/bucket/file?sig=x"),
    ).toBe(true);
    expect(isAllowedEvernoteAttachmentUrl("http://storage.googleapis.com/file")).toBe(false);
    expect(isAllowedEvernoteAttachmentUrl("https://127.0.0.1/admin")).toBe(false);
    expect(isAllowedEvernoteAttachmentUrl("https://metadata.google.internal/")).toBe(false);
  });
});

describe("Evernote unattended schedule", () => {
  it("prefers a due nightly reconcile, then 15-minute incremental work", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(
      evernoteScheduleDecision({
        now,
        lastSyncAt: new Date("2026-10-17T11:00:00Z"),
        lastFullReconcileAt: new Date("2026-10-16T11:59:00Z"),
        incrementalEnabled: true,
        fullReconcileEnabled: true,
        autoFullImportEnabled: false,
        inNightWindow: true,
        incrementalMinutes: 15,
        fullReconcileMinutes: 1440,
      }),
    ).toBe("full");
    expect(
      evernoteScheduleDecision({
        now,
        lastSyncAt: new Date("2026-10-17T11:44:00Z"),
        lastFullReconcileAt: new Date("2026-10-17T01:00:00Z"),
        incrementalEnabled: true,
        fullReconcileEnabled: true,
        autoFullImportEnabled: false,
        inNightWindow: false,
        incrementalMinutes: 15,
        fullReconcileMinutes: 1440,
      }),
    ).toBe("incremental");
  });

  it("never starts a first import unless auto-full is explicitly enabled at night", () => {
    const base = {
      now: new Date("2026-10-17T06:00:00Z"),
      lastSyncAt: null,
      lastFullReconcileAt: null,
      incrementalEnabled: true,
      fullReconcileEnabled: true,
      incrementalMinutes: 15,
      fullReconcileMinutes: 1440,
    };
    expect(
      evernoteScheduleDecision({
        ...base,
        autoFullImportEnabled: false,
        inNightWindow: true,
      }),
    ).toBeNull();
    expect(
      evernoteScheduleDecision({
        ...base,
        autoFullImportEnabled: true,
        inNightWindow: false,
      }),
    ).toBeNull();
    expect(
      evernoteScheduleDecision({
        ...base,
        autoFullImportEnabled: true,
        inNightWindow: true,
      }),
    ).toBe("full");
  });

  it("requires a passing load check before scheduled work", async () => {
    expect(
      await scheduledEvernoteLoadIsSafe(async () => ({
        safe: false,
        reasons: ["memory"],
        dbConnections: 10,
        availableMemoryMb: 100,
        unhealthyUrls: [],
      })),
    ).toBe(false);
    expect(
      await scheduledEvernoteLoadIsSafe(async () => ({
        safe: true,
        reasons: [],
        dbConnections: 10,
        availableMemoryMb: 300,
        unhealthyUrls: [],
      })),
    ).toBe(true);
  });
});

describe("Evernote attachment retry policy", () => {
  it("does not spend attempts for memory deferrals or size skips", () => {
    expect(evernoteAttachmentFailureTransition(2, "memory")).toEqual({
      attempts: 2,
      fetchState: "pending",
    });
    expect(evernoteAttachmentFailureTransition(2, "too_large")).toEqual({
      attempts: 2,
      fetchState: "skipped_too_large",
    });
    expect(evernoteAttachmentFailureTransition(2, "error")).toEqual({
      attempts: 3,
      fetchState: "failed",
    });
  });

  it("makes the third stale-fetch reset terminal", () => {
    expect(interruptedAttachmentResetOutcome(0)).toEqual({
      attempts: 1,
      fetchState: "pending",
    });
    expect(interruptedAttachmentResetOutcome(2)).toEqual({
      attempts: 3,
      fetchState: "failed_oom",
    });
    expect(shouldResetEvernoteAttachmentFailure("failed", 2)).toBe(true);
    expect(shouldResetEvernoteAttachmentFailure("failed", 3)).toBe(false);
    expect(
      shouldResetEvernoteAttachmentFailure("failed_oom", 1),
    ).toBe(false);
    expect(
      shouldResetEvernoteAttachmentFailure("skipped_too_large", 0),
    ).toBe(false);
  });
});

describe("Evernote import AI boundary", () => {
  it("contains no OpenAI or embedding invocation in the worker entrypoint", () => {
    const implementation = processEvernoteSyncJob.toString().toLowerCase();
    expect(implementation).not.toContain("openai");
    expect(implementation).not.toContain("embeditem");
    expect(implementation).not.toContain("warmentityembedding");
  });

  it("rechecks the night window on every scheduled full-import slice", () => {
    const implementation = processEvernoteSyncJob.toString();
    expect(implementation).toContain("evernoteScheduled");
    expect(implementation).toContain("isEvernoteNightWindow");
  });
});

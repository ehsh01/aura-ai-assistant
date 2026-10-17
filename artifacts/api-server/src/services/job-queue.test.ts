import { describe, expect, it } from "vitest";
import {
  backoffMs,
  attemptsAfterDeferredClaim,
  captureIdFromPayload,
  connectorSyncFromPayload,
  evernoteTransientDeferral,
  jobFailureIsTerminal,
  mapJobRow,
} from "./job-queue";

describe("job-queue helpers", () => {
  it("computes bounded exponential backoff", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(480_000);
    expect(backoffMs(10)).toBe(30 * 60_000);
  });

  it("refunds deferred claims without creating negative attempts", () => {
    expect(attemptsAfterDeferredClaim(1)).toBe(0);
    expect(attemptsAfterDeferredClaim(3)).toBe(2);
    expect(attemptsAfterDeferredClaim(0)).toBe(0);
  });

  it("detects rate limits, 503s, and HTML errors for attempt-free deferral", () => {
    expect(
      evernoteTransientDeferral({
        evernoteRateLimited: true,
        retryAfterMs: 12_000,
      }),
    ).toEqual({ retryAfterMs: 12_000 });
    expect(evernoteTransientDeferral({ status: 429 })).toEqual({
      retryAfterMs: 30_000,
    });
    expect(
      evernoteTransientDeferral(new Error("MCP rate limit exceeded")),
    ).toEqual({ retryAfterMs: 30_000 });
    expect(evernoteTransientDeferral({ status: 503 })).toEqual({
      retryAfterMs: 30_000,
    });
    expect(
      evernoteTransientDeferral(new Error("<html>backend read error</html>")),
    ).toEqual({ retryAfterMs: 30_000 });
    expect(evernoteTransientDeferral({ status: 500 })).toBeNull();
    expect(evernoteTransientDeferral({ status: 501 })).toBeNull();
    expect(evernoteTransientDeferral(new Error("ordinary failure"))).toBeNull();
  });

  it("makes only the third real Tesseract failure terminal", () => {
    expect(jobFailureIsTerminal(1, 3)).toBe(false);
    expect(jobFailureIsTerminal(2, 3)).toBe(false);
    expect(jobFailureIsTerminal(3, 3)).toBe(true);
  });

  it("maps snake_case claim rows onto Job", () => {
    const job = mapJobRow({
      id: "job-1",
      user_id: "11111111-1111-4111-8111-111111111111",
      type: "capture_extraction",
      payload: { captureId: "cap-1" },
      status: "processing",
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      available_at: "2026-07-14T00:00:00.000Z",
      locked_at: "2026-07-14T00:01:00.000Z",
      locked_by: "worker-1",
      started_at: "2026-07-14T00:01:00.000Z",
      completed_at: null,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-14T00:01:00.000Z",
    });

    expect(job).toMatchObject({
      id: "job-1",
      userId: "11111111-1111-4111-8111-111111111111",
      type: "capture_extraction",
      payload: { captureId: "cap-1" },
      status: "processing",
      attempts: 1,
      maxAttempts: 3,
      lockedBy: "worker-1",
    });
    expect(job.availableAt.toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("reads captureId from payload", () => {
    expect(captureIdFromPayload({ captureId: "cap-9" })).toBe("cap-9");
    expect(captureIdFromPayload({})).toBeNull();
    expect(captureIdFromPayload({ captureId: 1 })).toBeNull();
  });

  it("validates durable connector sync checkpoints", () => {
    expect(
      connectorSyncFromPayload({
        connectorId: "conn-evernote",
        syncRunId: "sync-1",
      }),
    ).toEqual({ connectorId: "conn-evernote", syncRunId: "sync-1" });
    expect(connectorSyncFromPayload({ connectorId: "conn-evernote" })).toBeNull();
  });
});

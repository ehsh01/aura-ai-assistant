import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; userId: string }>,
  limit: vi.fn(),
  enqueueGoogleSyncForUser: vi.fn(),
  nudgeJobWorker: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (limit: number) => {
              mocks.limit(limit);
              return Promise.resolve(mocks.rows.slice(0, limit));
            },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("./connectors", () => ({
  enqueueGoogleSyncForUser: mocks.enqueueGoogleSyncForUser,
}));

vi.mock("./job-worker", () => ({
  nudgeJobWorker: mocks.nudgeJobWorker,
}));

import {
  enqueueGoogleInitialSyncIfEnabled,
  startGoogleAutoSync,
  stopGoogleAutoSync,
  syncStaleGoogleConnectors,
} from "./google-auto-sync";

beforeEach(() => {
  delete process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED;
  mocks.rows = [];
  mocks.limit.mockReset();
  mocks.enqueueGoogleSyncForUser.mockReset();
  mocks.nudgeJobWorker.mockReset();
  stopGoogleAutoSync();
});

afterEach(() => {
  stopGoogleAutoSync();
  vi.useRealTimers();
});

describe("Google auto-sync scheduling", () => {
  it("creates no scheduler and performs no query when the flag is off", async () => {
    vi.useFakeTimers();
    startGoogleAutoSync();
    expect(vi.getTimerCount()).toBe(0);
    await expect(syncStaleGoogleConnectors()).resolves.toBe(0);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("selects and enqueues at most one connector per tick", async () => {
    process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED = "true";
    mocks.rows = [
      { id: "google-1", userId: "user-1" },
      { id: "google-2", userId: "user-2" },
    ];
    mocks.enqueueGoogleSyncForUser.mockResolvedValue({
      syncRunId: "run-1",
      jobId: "run-1",
      status: "queued",
      deduped: false,
    });

    await expect(syncStaleGoogleConnectors()).resolves.toBe(1);
    expect(mocks.limit).toHaveBeenCalledWith(1);
    expect(mocks.enqueueGoogleSyncForUser).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueGoogleSyncForUser).toHaveBeenCalledWith(
      "user-1",
      "google-1",
      { scheduled: true },
    );
    expect(mocks.nudgeJobWorker).toHaveBeenCalledWith("run-1");
  });

  it("does not nudge a duplicate active job", async () => {
    process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED = "true";
    mocks.rows = [{ id: "google-1", userId: "user-1" }];
    mocks.enqueueGoogleSyncForUser.mockResolvedValue({
      syncRunId: "run-active",
      jobId: "run-active",
      status: "running",
      deduped: true,
    });

    await expect(syncStaleGoogleConnectors()).resolves.toBe(0);
    expect(mocks.nudgeJobWorker).not.toHaveBeenCalled();
  });

  it("queues the first sync only when the flag is enabled", async () => {
    await expect(
      enqueueGoogleInitialSyncIfEnabled("user-1", "google-1"),
    ).resolves.toBe(false);
    expect(mocks.enqueueGoogleSyncForUser).not.toHaveBeenCalled();

    process.env.RECALL_GOOGLE_AUTO_SYNC_ENABLED = "true";
    mocks.enqueueGoogleSyncForUser.mockResolvedValue({
      syncRunId: "run-1",
      jobId: "run-1",
      status: "queued",
      deduped: false,
    });
    await expect(
      enqueueGoogleInitialSyncIfEnabled("user-1", "google-1"),
    ).resolves.toBe(true);
    expect(mocks.enqueueGoogleSyncForUser).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeJobWorker).toHaveBeenCalledWith("run-1");
  });
});

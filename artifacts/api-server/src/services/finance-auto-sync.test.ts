import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectorRow: null as {
    id: string;
    lastSyncAt: Date | null;
    syncStatus: string;
  } | null,
  enqueueFinanceSyncForUser: vi.fn(),
  nudgeJobWorker: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.connectorRow ? [mocks.connectorRow] : []),
        }),
      }),
    }),
  }),
}));

vi.mock("./connectors", () => ({
  enqueueFinanceSyncForUser: mocks.enqueueFinanceSyncForUser,
}));

vi.mock("./job-worker", () => ({
  nudgeJobWorker: mocks.nudgeJobWorker,
}));

vi.mock("./evernote-watchdog", () => ({
  checkEvernoteImportWatchdog: vi.fn(async () => ({
    safe: true,
    reasons: [],
  })),
}));

import {
  ensureUserFinanceFresh,
  FINANCE_ON_DEMAND_COOLDOWN_MS,
} from "./finance-auto-sync";

const USER = "user-1";

beforeEach(() => {
  mocks.enqueueFinanceSyncForUser.mockReset();
  mocks.nudgeJobWorker.mockReset();
  mocks.connectorRow = {
    id: "conn-1",
    lastSyncAt: null,
    syncStatus: "connected",
  };
  mocks.enqueueFinanceSyncForUser.mockResolvedValue({
    syncRunId: "run-1",
    jobId: "run-1",
    status: "queued",
    deduped: false,
  });
});

describe("ensureUserFinanceFresh", () => {
  it("skips entirely when the user has no finance connector", async () => {
    mocks.connectorRow = null;
    await expect(ensureUserFinanceFresh(USER)).resolves.toEqual({
      synced: false,
      skipped: true,
      updating: false,
    });
    expect(mocks.enqueueFinanceSyncForUser).not.toHaveBeenCalled();
  });

  it("uses a 20-minute default cooldown instead of refreshing on every app open", async () => {
    mocks.connectorRow = {
      id: "conn-1",
      lastSyncAt: new Date(Date.now() - FINANCE_ON_DEMAND_COOLDOWN_MS + 1_000),
      syncStatus: "connected",
    };
    const result = await ensureUserFinanceFresh(USER);
    expect(result).toEqual({
      synced: false,
      skipped: true,
      updating: false,
    });
    expect(mocks.enqueueFinanceSyncForUser).not.toHaveBeenCalled();
  });

  it("queues stale on-demand work and returns the snapshot immediately", async () => {
    await expect(ensureUserFinanceFresh(USER)).resolves.toEqual({
      synced: false,
      skipped: false,
      updating: true,
    });
    expect(mocks.enqueueFinanceSyncForUser).toHaveBeenCalledWith(USER, "conn-1");
    expect(mocks.nudgeJobWorker).toHaveBeenCalledWith("run-1");
  });

  it("supports the five-minute finance Ask cooldown", async () => {
    mocks.connectorRow = {
      id: "conn-1",
      lastSyncAt: new Date(Date.now() - 4 * 60_000),
      syncStatus: "connected",
    };
    await expect(
      ensureUserFinanceFresh(USER, { maxAgeMs: 5 * 60_000 }),
    ).resolves.toMatchObject({ skipped: true });
    expect(mocks.enqueueFinanceSyncForUser).not.toHaveBeenCalled();
  });
});

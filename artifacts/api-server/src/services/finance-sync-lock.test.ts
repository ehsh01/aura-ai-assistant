import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BusyError extends Error {}
  return {
    BusyError,
    lock: vi.fn(async () => {
      throw new BusyError("held");
    }),
  };
});

vi.mock("../lib/db", () => ({
  DatabaseAdvisoryLockBusyError: mocks.BusyError,
  withDbAdvisoryLock: mocks.lock,
  getDb: () => ({
    select: (selection?: Record<string, unknown>) => ({
      from: () => ({
        where: () =>
          selection?.type
            ? {
                limit: async () => [{ type: "finance_api" }],
              }
            : {
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: "last-run",
                      recordsFetched: 10,
                      recordsCreated: 1,
                      recordsUpdated: 2,
                      recordsSkipped: 7,
                      recordsFailed: 0,
                    },
                  ],
                }),
              },
      }),
    }),
  }),
}));

import {
  financeRunningSyncCutoff,
  syncConnectorForUser,
} from "./connectors";

describe("finance sync advisory lock", () => {
  it("limits the running-row backstop to the most recent 15 minutes", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(financeRunningSyncCutoff(now).toISOString()).toBe(
      "2026-10-22T11:45:00.000Z",
    );
    expect(
      Date.parse("2026-10-18T12:00:00Z") >=
        financeRunningSyncCutoff(now).getTime(),
    ).toBe(false);
  });

  it("uses the per-connector lock and returns the last snapshot when held", async () => {
    await expect(
      syncConnectorForUser("user-1", "finance-1"),
    ).resolves.toEqual({
      syncRunId: "last-run",
      skipped: true,
      skipReason: "advisory_lock",
      result: {
        recordsFetched: 10,
        recordsCreated: 1,
        recordsUpdated: 2,
        recordsSkipped: 7,
        recordsDeferred: 0,
        recordsDeleted: 0,
        recordsFailed: 0,
      },
    });
    expect(mocks.lock).toHaveBeenCalledWith(
      "finance-sync:finance-1",
      expect.any(Function),
    );
  });
});

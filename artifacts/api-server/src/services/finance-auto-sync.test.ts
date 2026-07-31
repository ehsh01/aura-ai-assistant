import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectorRow: null as { id: string; lastSyncAt: Date | null } | null,
  syncConnectorForUser: vi.fn(),
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
  syncConnectorForUser: mocks.syncConnectorForUser,
}));

import {
  ensureUserFinanceFresh,
  ON_DEMAND_SYNC_TIMEOUT_MS,
} from "./finance-auto-sync";

/**
 * In-flight syncs are coalesced per user in module state, so each test needs a
 * distinct user or a hung sync from one test would be handed to the next.
 */
let userSeq = 0;
let USER = "";

beforeEach(() => {
  mocks.syncConnectorForUser.mockReset();
  mocks.connectorRow = { id: "conn-1", lastSyncAt: null };
  userSeq += 1;
  USER = `user-${userSeq}`;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureUserFinanceFresh", () => {
  it("skips entirely when the user has no finance connector", async () => {
    mocks.connectorRow = null;
    await expect(ensureUserFinanceFresh(USER)).resolves.toEqual({
      synced: false,
      skipped: true,
    });
    expect(mocks.syncConnectorForUser).not.toHaveBeenCalled();
  });

  it("skips a sync that ran inside the cooldown window", async () => {
    mocks.connectorRow = { id: "conn-1", lastSyncAt: new Date() };
    const result = await ensureUserFinanceFresh(USER);
    expect(result.skipped).toBe(true);
    expect(mocks.syncConnectorForUser).not.toHaveBeenCalled();
  });

  it("gives up waiting on a slow sync instead of holding the request open", async () => {
    vi.useFakeTimers();
    // Never resolves: models MyFamilyBudget taking minutes, which previously
    // stacked requests until the process ran out of heap.
    mocks.syncConnectorForUser.mockReturnValue(new Promise(() => {}));

    const pending = ensureUserFinanceFresh(USER, {
      awaitSync: true,
      timeoutMs: ON_DEMAND_SYNC_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(ON_DEMAND_SYNC_TIMEOUT_MS + 10);

    await expect(pending).resolves.toEqual({
      synced: false,
      skipped: false,
      timedOut: true,
    });
  });

  it("returns normally when the sync finishes inside the timeout", async () => {
    mocks.syncConnectorForUser.mockResolvedValue(undefined);
    await expect(
      ensureUserFinanceFresh(USER, {
        awaitSync: true,
        timeoutMs: ON_DEMAND_SYNC_TIMEOUT_MS,
      }),
    ).resolves.toEqual({ synced: true, skipped: false });
  });

  it("coalesces concurrent refreshes into a single upstream sync", async () => {
    let release: () => void = () => {};
    mocks.syncConnectorForUser.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const all = Promise.all([
      ensureUserFinanceFresh(USER, { maxAgeMs: 0 }),
      ensureUserFinanceFresh(USER, { maxAgeMs: 0 }),
      ensureUserFinanceFresh(USER, { maxAgeMs: 0 }),
    ]);
    release();
    await all;

    expect(mocks.syncConnectorForUser).toHaveBeenCalledTimes(1);
  });

  it("reports failure without throwing so callers can use the last snapshot", async () => {
    mocks.syncConnectorForUser.mockRejectedValue(new Error("upstream down"));
    await expect(
      ensureUserFinanceFresh(USER, { maxAgeMs: 0, awaitSync: true }),
    ).resolves.toEqual({ synced: false, skipped: false });
  });
});

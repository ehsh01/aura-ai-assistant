import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  selectLimit: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mocks.insertReturning,
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.selectLimit,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mocks.updateReturning,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        }),
      }),
    }),
  }),
}));

vi.mock("../lib/recall-format", () => ({
  newAuthSessionId: () => "sess-fixed",
}));

import {
  assertAuthSessionActive,
  createAuthSession,
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
} from "./auth-sessions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth sessions", () => {
  it("creates a session row with the generated id", async () => {
    const expiresAt = new Date("2026-07-20T00:00:00Z");
    mocks.insertReturning.mockResolvedValue([
      {
        id: "sess-fixed",
        userId: "user-1",
        expiresAt,
        revokedAt: null,
      },
    ]);
    const row = await createAuthSession({ userId: "user-1", expiresAt });
    expect(row).toEqual({
      id: "sess-fixed",
      userId: "user-1",
      expiresAt,
      revokedAt: null,
    });
  });

  it("rejects missing or expired sessions", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    expect(await assertAuthSessionActive("missing")).toBe(false);

    mocks.selectLimit.mockResolvedValue([
      {
        id: "sess-fixed",
        userId: "user-1",
        expiresAt: new Date("2020-01-01T00:00:00Z"),
        revokedAt: null,
      },
    ]);
    expect(await assertAuthSessionActive("sess-fixed")).toBe(false);
  });

  it("accepts an active unexpired session", async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        id: "sess-fixed",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
    ]);
    // last-seen update is fire-and-forget; chain where().catch for update
    mocks.updateReturning.mockResolvedValue([]);
    expect(await assertAuthSessionActive("sess-fixed")).toBe(true);
  });

  it("revoke helpers return based on returning rows", async () => {
    mocks.updateReturning.mockResolvedValueOnce([{ id: "sess-fixed" }]);
    expect(await revokeAuthSession("sess-fixed", "user-1")).toBe(true);

    mocks.updateReturning.mockResolvedValueOnce([]);
    expect(await revokeAuthSession("sess-fixed", "user-1")).toBe(false);

    mocks.updateReturning.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    expect(await revokeAllAuthSessionsForUser("user-1")).toBe(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHome: vi.fn(),
}));

vi.mock("./recall-api", () => ({
  fetchHome: mocks.fetchHome,
}));

import {
  clearHomeCache,
  getCachedHome,
  loadHome,
} from "./home-cache";

beforeEach(() => {
  clearHomeCache();
  mocks.fetchHome.mockReset();
});

describe("Home cache account isolation", () => {
  it("clears cached data before another account loads Home", async () => {
    const first = { date: "first-user" };
    const second = { date: "second-user" };
    mocks.fetchHome.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await expect(loadHome()).resolves.toBe(first);
    expect(getCachedHome()).toBe(first);
    clearHomeCache();
    expect(getCachedHome()).toBeNull();
    await expect(loadHome()).resolves.toBe(second);
    expect(getCachedHome()).toBe(second);
  });

  it("does not repopulate the cache from an old account's in-flight request", async () => {
    let resolve!: (value: { date: string }) => void;
    mocks.fetchHome.mockReturnValueOnce(
      new Promise<{ date: string }>((done) => {
        resolve = done;
      }),
    );

    const pending = loadHome();
    clearHomeCache();
    resolve({ date: "old-user" });
    await pending;
    expect(getCachedHome()).toBeNull();
  });
});

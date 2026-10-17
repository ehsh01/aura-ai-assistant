import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Evernote worker boundary", () => {
  it("queues Sync Now and executes the connector only in the durable worker", async () => {
    const [routes, worker] = await Promise.all([
      readFile(new URL("../routes/connectors.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
    ]);

    expect(routes).toMatch(
      /connector\.type === "evernote"[\s\S]*enqueueEvernoteSyncForUser/,
    );
    expect(routes).not.toMatch(/nudgeJobWorker/);
    expect(worker).toMatch(
      /JOB_TYPE_CONNECTOR_SYNC[\s\S]*processEvernoteSyncJob/,
    );
  });
});

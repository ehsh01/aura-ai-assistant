import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Evernote worker boundary", () => {
  it("claims only the explicit Sync Now job while timer polling stays local-only", async () => {
    const [routes, worker, scheduler] = await Promise.all([
      readFile(new URL("../routes/connectors.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
      readFile(new URL("./evernote-sync-scheduler.ts", import.meta.url), "utf8"),
    ]);

    expect(routes).toMatch(
      /connector\.type === "evernote"[\s\S]*enqueueEvernoteSyncForUser/,
    );
    expect(routes).toMatch(/nudgeJobWorker\(queued\.jobId\)/);
    expect(worker).toMatch(
      /JOB_TYPE_CONNECTOR_SYNC[\s\S]*processEvernoteSyncJob/,
    );
    expect(worker).toMatch(
      /TIMER_SAFE_JOB_TYPES\s*=\s*\[JOB_TYPE_ATTACHMENT_EXTRACT\]/,
    );
    expect(worker).toMatch(
      /claimNextJobOfTypes\(workerId,\s*TIMER_SAFE_JOB_TYPES\)/,
    );
    expect(worker).toMatch(
      /continueJob\(job\.id\)[\s\S]*scheduleExplicitJobResume/,
    );
    expect(worker).toMatch(
      /deferJob\(job\.id,[\s\S]*scheduleExplicitJobResume/,
    );
    expect(worker).toMatch(
      /failJob\(job\.id,[\s\S]*scheduleExplicitJobResume\(queued\)/,
    );
    expect(worker).toMatch(
      /resumeQueuedConnectorJobs[\s\S]*listQueuedJobsOfType\(JOB_TYPE_CONNECTOR_SYNC\)/,
    );
    expect(scheduler).toMatch(/nudgeJobWorker\(result\.jobId\)/);
  });
});

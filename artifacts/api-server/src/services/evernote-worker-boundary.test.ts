import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Evernote worker boundary", () => {
  it("lets only the dedicated worker poll connector jobs", async () => {
    const [routes, worker, scheduler] = await Promise.all([
      readFile(new URL("../routes/connectors.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
      readFile(
        new URL("./evernote-sync-scheduler.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(routes).toMatch(
      /connector\.type === "evernote"[\s\S]*enqueueEvernoteSyncForUser/,
    );
    expect(routes).toMatch(/nudgeJobWorker\(queued\.jobId\)/);
    expect(worker).toMatch(
      /JOB_TYPE_CONNECTOR_SYNC[\s\S]*processEvernoteSyncJob/,
    );
    expect(worker).toMatch(
      /RECALL_ROLE[\s\S]*"worker"[\s\S]*JOB_TYPE_ATTACHMENT_EXTRACT,\s*JOB_TYPE_CONNECTOR_SYNC/,
    );
    expect(worker).toMatch(
      /RECALL_DISABLE_INLINE_WORKER === "1"[\s\S]*return;/,
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

  it("resumes a restarted attachment-phase job without entering note import", async () => {
    const [connectors, queue] = await Promise.all([
      readFile(new URL("./connectors.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-queue.ts", import.meta.url), "utf8"),
    ]);
    const attachmentPhase = connectors.indexOf('if (phase === "attachments")');
    const noteImport = connectors.indexOf(
      "const streamed = await withEvernoteMcpClient",
    );
    expect(attachmentPhase).toBeGreaterThan(0);
    expect(noteImport).toBeGreaterThan(attachmentPhase);
    const attachmentBranch = connectors.slice(attachmentPhase, noteImport);
    expect(attachmentBranch).toContain("resetInterruptedEvernoteAttachments");
    expect(attachmentBranch).toContain("processOneEvernoteAttachment");
    expect(attachmentBranch).toMatch(/return false;/);
    const staleRecovery = queue.slice(
      queue.indexOf("export async function recoverStaleProcessingJobs"),
    );
    expect(staleRecovery).toContain("else 'queued'");
    const explicitClaim = queue.slice(
      queue.indexOf("export async function claimJobById"),
      queue.indexOf("export async function completeJob"),
    );
    expect(explicitClaim).toContain("AND status = 'queued'");
  });
});

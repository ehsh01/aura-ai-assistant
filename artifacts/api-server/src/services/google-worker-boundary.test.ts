import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Google worker boundaries", () => {
  it("creates Google heartbeats inside the single advisory-lock connection scope", async () => {
    const [worker, connectors] = await Promise.all([
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
      readFile(new URL("./connectors.ts", import.meta.url), "utf8"),
    ]);
    const workerGoogleBranch = worker.slice(
      worker.indexOf('if (meta.connectorType === "google")'),
      worker.indexOf(
        "const lease = setInterval",
        worker.indexOf('if (meta.connectorType === "google")'),
      ),
    );
    const googleProcessor = connectors.slice(
      connectors.indexOf("export async function processGoogleSyncJob"),
      connectors.indexOf("export async function enqueueEvernoteSyncForUser"),
    );

    expect(workerGoogleBranch).toContain("() => heartbeatJob(job.id)");
    expect(workerGoogleBranch).not.toContain("setInterval");
    expect(googleProcessor).toMatch(
      /withDbAdvisoryLock[\s\S]*setInterval[\s\S]*heartbeat/,
    );
  });

  it("keeps paid AI hooks outside the Google durable processor", async () => {
    const connectors = await readFile(
      new URL("./connectors.ts", import.meta.url),
      "utf8",
    );
    const googleProcessor = connectors
      .slice(
        connectors.indexOf("async function processGoogleSyncJobLocked"),
        connectors.indexOf("export async function enqueueEvernoteSyncForUser"),
      )
      .toLowerCase();
    expect(googleProcessor).not.toMatch(
      /openai|warmentityembedding|attention_scan|waiting_scan/,
    );
  });
});

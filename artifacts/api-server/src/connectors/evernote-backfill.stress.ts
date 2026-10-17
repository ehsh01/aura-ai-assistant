import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { streamEvernoteViaMcp } from "./evernote-mcp";

const NOTE_COUNT = 5_250;
const SUMMARY_PADDING_BYTES = 96 * 1024;
const BODY_BYTES = 512 * 1024;

function guid(index: number): string {
  return `note-${String(index).padStart(8, "0")}`;
}

function flatText(bytes: number, suffix: string): string {
  const buffer = Buffer.alloc(bytes, 120);
  buffer.write(suffix, Math.max(0, bytes - Buffer.byteLength(suffix)));
  return buffer.toString("utf8");
}

function memoryMb() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss / 1024 / 1024,
    heapUsed: usage.heapUsed / 1024 / 1024,
  };
}

async function legacyAccumulation(): Promise<void> {
  const all: unknown[] = [];
  for (let start = 0; start < NOTE_COUNT; start += 100) {
    const count = Math.min(100, NOTE_COUNT - start);
    const page = Array.from({ length: count }, (_, offset) => ({
      id: guid(start + offset),
      updatedAt: "2026-10-17T00:00:00.000Z",
      preview: flatText(SUMMARY_PADDING_BYTES, guid(start + offset)),
    }));
    // Models the pre-fix summaries.push(...page) behavior.
    all.push(...page);
  }
  console.log(JSON.stringify({ mode: "legacy", retained: all.length, ...memoryMb() }));
}

async function measureLegacyAccumulation(): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "--max-old-space-size=384",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      "--legacy",
    ],
    { stdio: "ignore" },
  );
  let peakRssKb = 0;
  const sample = async () => {
    if (!child.pid) return;
    try {
      const status = await readFile(`/proc/${child.pid}/status`, "utf8");
      const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0);
      peakRssKb = Math.max(peakRssKb, rss);
    } catch {
      // Process exited between the timer firing and the procfs read.
    }
  };
  const timer = setInterval(() => void sample(), 10);
  const outcome = await new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  clearInterval(timer);
  await sample();
  console.log(
    JSON.stringify({
      mode: "legacy-measured",
      ...outcome,
      peakRssMb: Number((peakRssKb / 1024).toFixed(1)),
      oomReproduced: outcome.signal === "SIGABRT" || outcome.code !== 0,
    }),
  );
  if (outcome.code === 0 && outcome.signal == null) process.exitCode = 1;
}

async function boundedBackfill(): Promise<void> {
  process.env.EVERNOTE_MCP_PACE_MS = "0";
  process.env.EVERNOTE_MCP_BACKFILL_CHUNK_SIZE = "25";

  let persisted = 0;
  let embedded = 0;
  let peakRss = 0;
  let peakHeapUsed = 0;
  let warmHeapUsed = 0;
  let batches = 0;

  const client = {
    async callTool(input: {
      name: string;
      arguments?: Record<string, unknown>;
    }): Promise<unknown> {
      if (input.name === "search_notebooks") {
        return { structuredContent: { notebooks: [] } };
      }
      if (input.name === "search_tags") {
        return { structuredContent: { tags: [] } };
      }
      if (input.name === "search_spaces") {
        return { structuredContent: { spaces: [] } };
      }
      if (input.name === "search_notes") {
        const start = Number(input.arguments?.startIndex ?? 0);
        const max = Number(input.arguments?.maxResults ?? 25);
        const count = Math.min(max, NOTE_COUNT - start);
        return {
          structuredContent: {
            totalResultCount: NOTE_COUNT,
            notes: Array.from({ length: count }, (_, offset) => ({
              id: guid(start + offset),
              updatedAt: "2026-10-17T00:00:00.000Z",
              // Real MCP payloads may contain unexpectedly large summary fields.
              preview: flatText(
                SUMMARY_PADDING_BYTES,
                guid(start + offset),
              ),
            })),
          },
        };
      }
      if (input.name === "get_note") {
        const id = String(input.arguments?.noteId);
        return {
          structuredContent: {
            id,
            title: `Large mock note ${id}`,
            content: `<en-note>${flatText(BODY_BYTES, id)}</en-note>`,
            updatedAt: "2026-10-17T00:00:00.000Z",
            // Binary attachment bytes are intentionally ignored by the mapper.
            resources: [{ id: `attachment-${id}`, data: flatText(1024, id) }],
          },
        };
      }
      throw new Error(`Unexpected tool ${input.name}`);
    },
  };

  const result = await streamEvernoteViaMcp(client, {
    syncRunId: "stress-run",
    loadKnownNotes: async () => new Map(),
    processBatch: async (batch) => {
      if (batch.records.length > 25) {
        throw new Error(`Batch exceeded bound: ${batch.records.length}`);
      }
      for (const record of batch.records) {
        if (record.recordText.length > BODY_BYTES + 2_000) {
          throw new Error(`Record content exceeded bound: ${record.recordText.length}`);
        }
        persisted += 1;
      }
      // Evernote import is permanently keyword-only.
      embedded = 0;
      batches += 1;
      if (batches % 20 === 0) global.gc?.();
      const sample = memoryMb();
      peakRss = Math.max(peakRss, sample.rss);
      peakHeapUsed = Math.max(peakHeapUsed, sample.heapUsed);
      if (batches === 20) warmHeapUsed = sample.heapUsed;
    },
  });

  global.gc?.();
  const ending = memoryMb();
  const heapGrowthAfterWarmup = ending.heapUsed - warmHeapUsed;
  const report = {
    mode: "bounded",
    notes: NOTE_COUNT,
    batches,
    persisted,
    embedded,
    recordsDeferred: result.recordsDeferred,
    peakRssMb: Number(peakRss.toFixed(1)),
    peakHeapUsedMb: Number(peakHeapUsed.toFixed(1)),
    endingRssMb: Number(ending.rss.toFixed(1)),
    endingHeapUsedMb: Number(ending.heapUsed.toFixed(1)),
    heapGrowthAfterWarmupMb: Number(heapGrowthAfterWarmup.toFixed(1)),
  };
  console.log(JSON.stringify(report));
  if (persisted !== NOTE_COUNT || result.recordsDeferred !== 0) process.exitCode = 1;
  if (peakRss >= 320 || peakHeapUsed >= 192 || heapGrowthAfterWarmup >= 40) {
    process.exitCode = 1;
  }
}

if (process.argv.includes("--measure-legacy")) {
  await measureLegacyAccumulation();
} else if (process.argv.includes("--legacy")) {
  await legacyAccumulation();
} else {
  await boundedBackfill();
}

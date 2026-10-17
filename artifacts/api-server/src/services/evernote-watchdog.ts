import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";

export type EvernoteWatchdogStatus = {
  safe: boolean;
  reasons: string[];
  dbConnections: number | null;
  availableMemoryMb: number | null;
  unhealthyUrls: string[];
};

export class EvernoteWatchdogPauseError extends Error {
  readonly retryAfterMs: number;

  constructor(
    public readonly status: EvernoteWatchdogStatus,
    retryAfterMs = watchdogRetryMs(),
  ) {
    super(`Evernote import paused by load watchdog: ${status.reasons.join("; ")}`);
    this.name = "EvernoteWatchdogPauseError";
    this.retryAfterMs = retryAfterMs;
  }
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function watchdogDbConnectionLimit(): number {
  return envNumber("EVERNOTE_WATCHDOG_DB_CONNECTIONS", 15, 1, 1_000);
}

export function watchdogMinMemoryMb(): number {
  return envNumber("EVERNOTE_WATCHDOG_MIN_MEM_MB", 200, 1, 1_000_000);
}

export function watchdogRetryMs(): number {
  return envNumber("EVERNOTE_WATCHDOG_RETRY_MS", 60_000, 1_000, 3_600_000);
}

export function watchdogHealthUrls(): string[] {
  return (process.env.EVERNOTE_WATCHDOG_HEALTH_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export function parseMemAvailableMb(meminfo: string): number | null {
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) return null;
  return Number(match[1]) / 1024;
}

export function requiredMemoryMbForBytes(sizeBytes: number): number {
  const scaled =
    Number.isFinite(sizeBytes) && sizeBytes > 0
      ? (sizeBytes / (1024 * 1024)) * 2.5
      : 0;
  return Math.max(200, watchdogMinMemoryMb(), scaled);
}

async function defaultDbConnections(): Promise<number | null> {
  try {
    const result = await getDb().execute(
      sql`SELECT cast(count(*) as int) AS count
          FROM pg_stat_activity
          WHERE backend_type = 'client backend'
            AND datname = current_database()`,
    );
    const rows =
      (result as { rows?: Array<Record<string, unknown>> }).rows ??
      (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);
    const count = Number(rows[0]?.count);
    return Number.isFinite(count) ? count : null;
  } catch {
    // Some managed roles cannot inspect every pg_stat_activity row. In that
    // case the other watchdog gates remain active.
    return null;
  }
}

async function defaultAvailableMemoryMb(): Promise<number | null> {
  try {
    return parseMemAvailableMb(await readFile("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

async function defaultHealthCheck(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    envNumber("EVERNOTE_WATCHDOG_HEALTH_TIMEOUT_MS", 5_000, 250, 30_000),
  );
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkEvernoteImportWatchdog(deps?: {
  dbConnections?: () => Promise<number | null>;
  availableMemoryMb?: () => Promise<number | null>;
  healthCheck?: (url: string) => Promise<boolean>;
  healthUrls?: string[];
  minimumMemoryMb?: number;
  requireMemoryMeasurement?: boolean;
}): Promise<EvernoteWatchdogStatus> {
  const [dbConnections, availableMemoryMb] = await Promise.all([
    (deps?.dbConnections ?? defaultDbConnections)(),
    (deps?.availableMemoryMb ?? defaultAvailableMemoryMb)(),
  ]);
  const urls = deps?.healthUrls ?? watchdogHealthUrls();
  const checks = await Promise.all(
    urls.map(async (url) => ({
      url,
      healthy: await (deps?.healthCheck ?? defaultHealthCheck)(url),
    })),
  );
  const unhealthyUrls = checks.filter((check) => !check.healthy).map((check) => check.url);
  const reasons: string[] = [];
  const minimumMemoryMb = Math.max(
    watchdogMinMemoryMb(),
    deps?.minimumMemoryMb ?? 0,
  );
  if (dbConnections != null && dbConnections >= watchdogDbConnectionLimit()) {
    reasons.push(
      `recall DB client connections ${dbConnections} >= ${watchdogDbConnectionLimit()}`,
    );
  }
  if (availableMemoryMb == null && deps?.requireMemoryMeasurement) {
    reasons.push("available memory could not be measured");
  } else if (availableMemoryMb != null && availableMemoryMb < minimumMemoryMb) {
    reasons.push(
      `available memory ${availableMemoryMb.toFixed(1)} MB < ${minimumMemoryMb.toFixed(1)} MB`,
    );
  }
  if (unhealthyUrls.length > 0) {
    reasons.push(`health checks failed: ${unhealthyUrls.join(", ")}`);
  }
  return {
    safe: reasons.length === 0,
    reasons,
    dbConnections,
    availableMemoryMb,
    unhealthyUrls,
  };
}

export async function assertEvernoteImportSafe(
  options?: Parameters<typeof checkEvernoteImportWatchdog>[0],
): Promise<void> {
  const status = await checkEvernoteImportWatchdog(options);
  if (!status.safe) throw new EvernoteWatchdogPauseError(status);
}

export function evernoteDeferredError(
  reason: string,
  retryAfterMs = watchdogRetryMs(),
): EvernoteWatchdogPauseError {
  return new EvernoteWatchdogPauseError(
    {
      safe: false,
      reasons: [reason],
      dbConnections: null,
      availableMemoryMb: null,
      unhealthyUrls: [],
    },
    retryAfterMs,
  );
}

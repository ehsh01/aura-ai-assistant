import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;
const scopedDb = new AsyncLocalStorage<Db>();

export class DatabaseAdvisoryLockBusyError extends Error {
  readonly status = 503;

  constructor(key: string) {
    super(`Database advisory lock is busy: ${key}`);
    this.name = "DatabaseAdvisoryLockBusyError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function normalizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/ondigitalocean\.com/i.test(parsed.hostname)) {
      parsed.searchParams.delete("sslmode");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function poolSsl(url: string): pg.PoolConfig["ssl"] {
  if (/localhost|127\.0\.0\.1/.test(url)) {
    return undefined;
  }
  if (/ondigitalocean\.com|sslmode=/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export function getDb(): Db {
  const scoped = scopedDb.getStore();
  if (scoped) return scoped;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!db) {
    const connectionString = normalizeDatabaseUrl(url);
    const workerProcess =
      process.env.RECALL_ROLE?.trim().toLowerCase() === "worker";
    pool = new pg.Pool({
      connectionString,
      // The DO managed cluster is shared with sibling apps (~25 conn cap total).
      // Keep Recall's slice small; queries queue in-process instead of starving
      // other apps of connection slots.
      max: workerProcess
        ? envInt("PG_WORKER_POOL_MAX", 3, 1, 3)
        : envInt("PG_POOL_MAX", 3, 1, 3),
      idleTimeoutMillis: envInt("PG_IDLE_TIMEOUT_MS", 10_000, 1_000, 300_000),
      connectionTimeoutMillis: envInt(
        "PG_CONNECT_TIMEOUT_MS",
        15_000,
        1_000,
        60_000,
      ),
      // Identifiable in pg_stat_activity when auditing shared-cluster usage.
      application_name: workerProcess ? "recall-worker" : "recall-api",
      ssl: poolSsl(url),
    });
    db = drizzle(pool as never, { schema });
  }
  return db;
}

/**
 * Serialize connector work across API/worker processes while keeping every
 * query in the callback on the connection that owns the session lock.
 */
export async function withDbAdvisoryLock<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  getDb();
  if (!pool) throw new Error("Database pool is not initialized");
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [key],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new DatabaseAdvisoryLockBusyError(key);
    const lockedDb = drizzle(client as never, { schema }) as Db;
    return await scopedDb.run(lockedDb, callback);
  } finally {
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [key],
        );
      } catch (error) {
        client.release(
          error instanceof Error
            ? error
            : new Error("Could not release database advisory lock"),
        );
        throw error;
      }
    }
    client.release();
  }
}

/**
 * Blocking advisory lock for correctness-critical accounting sections. Unlike
 * the connector lock above, callers queue instead of failing while it is held.
 */
export async function withDbAdvisoryLockWait<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  getDb();
  if (!pool) throw new Error("Database pool is not initialized");
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      key,
    ]);
    locked = true;
    const lockedDb = drizzle(client as never, { schema }) as Db;
    return await scopedDb.run(lockedDb, callback);
  } finally {
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [key],
        );
      } catch (error) {
        client.release(
          error instanceof Error
            ? error
            : new Error("Could not release database advisory lock"),
        );
        throw error;
      }
    }
    client.release();
  }
}

/** Run service helpers atomically by scoping getDb() to one transaction. */
export async function withDbTransaction<T>(
  callback: () => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (transaction) =>
    scopedDb.run(transaction as unknown as Db, callback),
  );
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };

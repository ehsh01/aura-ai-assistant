import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

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

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!db) {
    const connectionString = normalizeDatabaseUrl(url);
    pool = new pg.Pool({
      connectionString,
      // The DO managed cluster is shared with sibling apps (~25 conn cap total).
      // Keep Recall's slice small; queries queue in-process instead of starving
      // other apps of connection slots.
      max: envInt("PG_POOL_MAX", 4, 1, 10),
      idleTimeoutMillis: envInt("PG_IDLE_TIMEOUT_MS", 10_000, 1_000, 300_000),
      connectionTimeoutMillis: envInt("PG_CONNECT_TIMEOUT_MS", 15_000, 1_000, 60_000),
      // Identifiable in pg_stat_activity when auditing shared-cluster usage.
      application_name: "recall-api",
      ssl: poolSsl(url),
    });
    db = drizzle(pool as never, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };

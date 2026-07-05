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

export function getDb(): Db {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!db) {
    const connectionString = normalizeDatabaseUrl(url);
    pool = new pg.Pool({
      connectionString,
      max: 10,
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

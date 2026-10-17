import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Shared DO cluster (~25 conn cap across apps) — keep any script/tool pool small.
const poolMax = Number.parseInt(process.env.PG_IMPORT_POOL_MAX ?? "", 10);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Import/migration processes get their own hard cap so they cannot consume
  // the API pool's allowance on the shared 25-connection cluster.
  max: Number.isFinite(poolMax) && poolMax > 0 ? Math.min(poolMax, 3) : 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  application_name: "recall-scripts",
});
export const db = drizzle(pool, { schema });

export * from "./schema";

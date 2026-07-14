import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getDb, isDatabaseConfigured } from "../lib/db";
import { getJobQueueStats } from "../services/job-queue";

const router: IRouter = Router();

/** Shallow liveness for load balancers / PM2. */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness: Postgres + durable job queue snapshot.
 * Does not change /healthz contract used by nginx/PM2 probes.
 */
router.get("/ready", async (_req, res) => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({
      status: "not_ready",
      database: "unconfigured",
      jobs: null,
    });
    return;
  }

  try {
    await getDb().execute(sql`select 1`);
    const jobs = await getJobQueueStats();
    res.json({
      status: "ready",
      database: "ok",
      jobs,
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      database: "error",
      error: err instanceof Error ? err.message : "database check failed",
      jobs: null,
    });
  }
});

export default router;

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../lib/db/migrations/0030_briefing_prefs.sql",
  import.meta.url,
);

const USER = "11111111-1111-4111-8111-111111111111";

describe("0030_briefing_prefs migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      'CREATE TABLE "users" ("id" uuid PRIMARY KEY, "email" varchar(255) NOT NULL)',
    );
    await db.exec(`INSERT INTO "users" ("id", "email") VALUES ('${USER}', 'a@b.c')`);
    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("is idempotent", async () => {
    await expect(db.exec(await readFile(migrationUrl, "utf8"))).resolves.toBeDefined();
  });

  it("applies safe defaults (briefings off, quiet hours 21:00-08:00)", async () => {
    const { rows } = await db.query<{
      timezone: string | null;
      morning_briefing_enabled: boolean;
      morning_briefing_time: string;
      evening_checkin_enabled: boolean;
      evening_checkin_time: string;
      quiet_hours_start: string;
      quiet_hours_end: string;
      last_morning_briefing_on: string | null;
      last_evening_checkin_on: string | null;
    }>(
      `SELECT timezone, morning_briefing_enabled, morning_briefing_time,
              evening_checkin_enabled, evening_checkin_time,
              quiet_hours_start, quiet_hours_end,
              last_morning_briefing_on, last_evening_checkin_on
       FROM users WHERE id = '${USER}'`,
    );
    expect(rows[0]).toEqual({
      timezone: null,
      morning_briefing_enabled: false,
      morning_briefing_time: "07:30",
      evening_checkin_enabled: false,
      evening_checkin_time: "17:30",
      quiet_hours_start: "21:00",
      quiet_hours_end: "08:00",
      last_morning_briefing_on: null,
      last_evening_checkin_on: null,
    });
  });

  it("stores prefs and send markers round-trip", async () => {
    await db.exec(`
      UPDATE users SET
        timezone = 'America/New_York',
        morning_briefing_enabled = true,
        morning_briefing_time = '06:45',
        evening_checkin_enabled = true,
        evening_checkin_time = '18:15',
        quiet_hours_start = '22:30',
        quiet_hours_end = '06:00',
        last_morning_briefing_on = '2026-07-28',
        last_evening_checkin_on = '2026-07-27'
      WHERE id = '${USER}'
    `);
    const { rows } = await db.query<{
      timezone: string;
      morning_briefing_enabled: boolean;
      morning_briefing_time: string;
      evening_checkin_time: string;
      quiet_hours_start: string;
      quiet_hours_end: string;
      last_morning_briefing_on: string;
      last_evening_checkin_on: string;
    }>(
      `SELECT timezone, morning_briefing_enabled, morning_briefing_time,
              evening_checkin_time, quiet_hours_start, quiet_hours_end,
              last_morning_briefing_on, last_evening_checkin_on
       FROM users WHERE id = '${USER}'`,
    );
    expect(rows[0]).toEqual({
      timezone: "America/New_York",
      morning_briefing_enabled: true,
      morning_briefing_time: "06:45",
      evening_checkin_time: "18:15",
      quiet_hours_start: "22:30",
      quiet_hours_end: "06:00",
      last_morning_briefing_on: "2026-07-28",
      last_evening_checkin_on: "2026-07-27",
    });
  });
});

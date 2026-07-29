-- Daily briefing preferences: per-user schedule, quiet hours, timezone + send tracking.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone varchar(64),
  ADD COLUMN IF NOT EXISTS morning_briefing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS morning_briefing_time varchar(5) NOT NULL DEFAULT '07:30',
  ADD COLUMN IF NOT EXISTS evening_checkin_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evening_checkin_time varchar(5) NOT NULL DEFAULT '17:30',
  ADD COLUMN IF NOT EXISTS quiet_hours_start varchar(5) NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end varchar(5) NOT NULL DEFAULT '08:00',
  -- Idempotency markers (user-local ISO dates) so retries/restarts never double-send.
  ADD COLUMN IF NOT EXISTS last_morning_briefing_on varchar(10),
  ADD COLUMN IF NOT EXISTS last_evening_checkin_on varchar(10);

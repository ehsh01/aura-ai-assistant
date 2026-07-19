-- SMS reminder delivery: per-user phone/prefs + per-item send tracking.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number varchar(32),
  ADD COLUMN IF NOT EXISTS sms_reminders_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_lead_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE attention_items
  ADD COLUMN IF NOT EXISTS sms_heads_up_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_due_sent_at timestamptz;

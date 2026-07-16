-- Admin + account disable flags (additive).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- Bootstrap primary admin (idempotent).
UPDATE users
SET is_admin = true
WHERE lower(email) = 'ehernandez2@gmail.com'
  AND is_admin = false;

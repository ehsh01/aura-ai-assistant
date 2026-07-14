-- Revocable browser sessions (JWT jti ↔ auth_sessions row).
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "auth_sessions_user_created_idx"
  ON "auth_sessions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "auth_sessions_user_active_idx"
  ON "auth_sessions" ("user_id", "revoked_at");

COMMIT;

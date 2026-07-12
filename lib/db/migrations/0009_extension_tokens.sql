-- Scoped, revocable credentials for browser-extension capture.
-- Additive + idempotent. Raw token values are never stored.

BEGIN;

CREATE TABLE IF NOT EXISTS "extension_tokens" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL DEFAULT 'Recall browser extension',
  "token_hash" varchar(64) NOT NULL,
  "scope" varchar(64) NOT NULL DEFAULT 'capture:create',
  "expires_at" timestamptz NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "extension_tokens_scope_check"
    CHECK ("scope" = 'capture:create'),
  CONSTRAINT "extension_tokens_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_tokens_expiry_check"
    CHECK ("expires_at" > "created_at")
);

-- Repair constraints if an earlier partial run created the table without them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'extension_tokens_scope_check'
      AND conrelid = 'extension_tokens'::regclass
  ) THEN
    ALTER TABLE "extension_tokens"
      ADD CONSTRAINT "extension_tokens_scope_check"
      CHECK ("scope" = 'capture:create');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'extension_tokens_hash_check'
      AND conrelid = 'extension_tokens'::regclass
  ) THEN
    ALTER TABLE "extension_tokens"
      ADD CONSTRAINT "extension_tokens_hash_check"
      CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'extension_tokens_expiry_check'
      AND conrelid = 'extension_tokens'::regclass
  ) THEN
    ALTER TABLE "extension_tokens"
      ADD CONSTRAINT "extension_tokens_expiry_check"
      CHECK ("expires_at" > "created_at");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "extension_tokens_token_hash_uidx"
  ON "extension_tokens" ("token_hash");

CREATE INDEX IF NOT EXISTS "extension_tokens_user_created_idx"
  ON "extension_tokens" ("user_id", "created_at");

COMMIT;

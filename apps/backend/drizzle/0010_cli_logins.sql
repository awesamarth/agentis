CREATE TABLE "cli_logins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "challenge" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "owner_id" text,
  "selections" jsonb,
  "consumed_at" timestamp with time zone
);
CREATE INDEX "cli_logins_expiry" ON "cli_logins" ("expires_at");

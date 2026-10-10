CREATE TABLE "card_vaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL,
  "client_fingerprint" text NOT NULL,
  "user_id" text NOT NULL,
  "test_mode" boolean NOT NULL,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_vault_owner_client" ON "card_vaults" ("owner_id", "client_fingerprint");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_vault_user_client" ON "card_vaults" ("user_id", "client_fingerprint");
--> statement-breakpoint
CREATE TABLE "card_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL,
  "client_fingerprint" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "provider_session_id" text UNIQUE,
  "expected_user_id" text,
  "status" text NOT NULL CHECK ("status" IN ('creating', 'pending', 'linked', 'expired', 'unknown', 'cancelled')),
  "encrypted_url" text,
  "test_mode" boolean,
  "poll_interval" integer DEFAULT 3 NOT NULL CHECK ("poll_interval" BETWEEN 1 AND 300),
  "next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_session_idempotency" ON "card_sessions" ("owner_id", "client_fingerprint", "idempotency_key");

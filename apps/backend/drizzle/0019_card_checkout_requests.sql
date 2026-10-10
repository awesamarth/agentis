CREATE TABLE "card_checkout_permissions" (
  "grant_id" uuid PRIMARY KEY REFERENCES "grants"("id") NOT NULL,
  "owner_id" text NOT NULL,
  "agent_id" uuid REFERENCES "agents"("id") NOT NULL,
  "vault_id" uuid REFERENCES "card_vaults"("id") NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_checkouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL,
  "agent_id" uuid REFERENCES "agents"("id") NOT NULL,
  "grant_id" uuid REFERENCES "grants"("id"),
  "vault_id" uuid REFERENCES "card_vaults"("id") NOT NULL,
  "client_fingerprint" text NOT NULL,
  "test_mode" boolean NOT NULL,
  "principal_key" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "operation_hash" text NOT NULL,
  "policy_hash" text NOT NULL,
  "permission_revision" integer,
  "vault_linked_at" timestamp with time zone NOT NULL,
  "rail" text NOT NULL DEFAULT 'browser' CHECK ("rail" IN ('browser', 'purchase')),
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "intent_id" text NOT NULL,
  "merchant" text NOT NULL,
  "checkout_origin" text NOT NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" >= 1 AND "amount_minor" <= 99999999),
  "encrypted_request" text NOT NULL,
  "encrypted_approval_url" text,
  "encrypted_replay" text,
  "status" text NOT NULL CHECK ("status" IN ('pending_approval','queued','submitting','awaiting_provider','unknown','confirmed','failed','rejected','expired')),
  "provider_id" text UNIQUE,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "budget_unsafe" boolean DEFAULT false NOT NULL,
  "usd_reserved_micros" text NOT NULL,
  "usd_settled_micros" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "settled_at" timestamp with time zone,
  "next_poll_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_purchase_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL, "agent_id" uuid NOT NULL REFERENCES "agents"("id"), "grant_id" uuid REFERENCES "grants"("id"), "vault_id" uuid NOT NULL REFERENCES "card_vaults"("id"),
  "principal_key" text NOT NULL, "idempotency_key" text NOT NULL, "request_hash" text NOT NULL,
  "provider_conversation_id" text, "encrypted_input" text NOT NULL, "encrypted_result" text,
  "status" text NOT NULL CHECK ("status" IN ('running','complete','unknown')), "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "card_purchase_turn_key" ON "card_purchase_turns" ("principal_key", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_checkout_idempotency" ON "card_checkouts" ("principal_key", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_checkout_active_intent" ON "card_checkouts" ("owner_id", "client_fingerprint", "intent_id") WHERE "status" IN ('pending_approval','queued','submitting','awaiting_provider','unknown','confirmed');

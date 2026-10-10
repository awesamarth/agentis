-- Preserve existing Agentcard connections/history without enabling the plugin or granting access.
ALTER TABLE "card_vaults" ADD COLUMN "provider" text NOT NULL DEFAULT 'agentcard';
--> statement-breakpoint
ALTER TABLE "card_sessions" ADD COLUMN "provider" text NOT NULL DEFAULT 'agentcard';
--> statement-breakpoint
ALTER TABLE "card_checkouts" ADD COLUMN "provider" text NOT NULL DEFAULT 'agentcard';
--> statement-breakpoint
DROP INDEX "card_vault_owner_client";
CREATE UNIQUE INDEX "card_vault_owner_client" ON "card_vaults" ("owner_id", "provider", "client_fingerprint");
--> statement-breakpoint
DROP INDEX "card_vault_user_client";
CREATE UNIQUE INDEX "card_vault_user_client" ON "card_vaults" ("provider", "user_id", "client_fingerprint");
--> statement-breakpoint
DROP INDEX "card_session_idempotency";
CREATE UNIQUE INDEX "card_session_idempotency" ON "card_sessions" ("owner_id", "provider", "client_fingerprint", "idempotency_key");
--> statement-breakpoint
DROP INDEX "card_checkout_idempotency";
CREATE UNIQUE INDEX "card_checkout_idempotency" ON "card_checkouts" ("provider", "principal_key", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "card_sessions" DROP CONSTRAINT "card_sessions_provider_session_id_key";
CREATE UNIQUE INDEX "card_session_provider_id" ON "card_sessions" ("provider", "provider_session_id");
--> statement-breakpoint
ALTER TABLE "card_checkouts" DROP CONSTRAINT "card_checkouts_provider_id_key";
CREATE UNIQUE INDEX "card_checkout_provider_id" ON "card_checkouts" ("provider", "provider_id");
--> statement-breakpoint
DROP INDEX "card_checkout_active_intent";
CREATE UNIQUE INDEX "card_checkout_active_intent" ON "card_checkouts" ("owner_id", "provider", "client_fingerprint", "intent_id") WHERE "status" IN ('pending_approval','queued','submitting','awaiting_provider','unknown','confirmed');

ALTER TABLE "grants" ALTER COLUMN "walletId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "agentId" uuid REFERENCES "agents"("id");--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grant_exactly_one_scope" CHECK (("walletId" IS NULL) <> ("agentId" IS NULL));

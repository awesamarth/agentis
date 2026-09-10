ALTER TABLE "grants" ADD COLUMN "chainIds" text[];--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grant_network_scope" CHECK ("chainIds" IS NULL OR ("agentId" IS NOT NULL AND cardinality("chainIds") > 0 AND array_position("chainIds", NULL) IS NULL));

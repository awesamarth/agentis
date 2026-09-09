CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"limits" jsonb NOT NULL,
	"mode" text NOT NULL,
	"allowedRecipients" jsonb NOT NULL,
	"networks" jsonb NOT NULL,
	"defaultNetwork" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "agentId" uuid;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Preserve existing hosted wallets and their policies; group them without re-provisioning keys.
WITH existing AS (
  SELECT w.*, CASE w."chainId"
    WHEN 'eip155:84532' THEN 'base' WHEN 'eip155:5042002' THEN 'arc'
    WHEN 'eip155:42431' THEN 'tempo' WHEN 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' THEN 'solana'
  END AS network FROM wallets w WHERE w.provider = 'privy'
)
INSERT INTO agents (id, "ownerId", name, limits, mode, "allowedRecipients", networks, "defaultNetwork")
SELECT gen_random_uuid(), w."ownerId", 'Existing agent',
  jsonb_build_object('perTransaction', NULL, 'hourly', NULL, 'daily', NULL, 'total', o."totalBudgetUsdMicros"),
  CASE WHEN bool_or(w.policy->>'mode' = 'paused') THEN 'paused' ELSE 'ask' END,
  '[]'::jsonb, COALESCE(o.networks, jsonb_agg(DISTINCT w.network) FILTER (WHERE w.network IS NOT NULL AND w.enabled), '[]'::jsonb),
  COALESCE(o."defaultNetwork", min(w.network), 'base')
FROM existing w LEFT JOIN onboarding o ON o."ownerId" = w."ownerId"
GROUP BY w."ownerId", o."totalBudgetUsdMicros", o.networks, o."defaultNetwork";
--> statement-breakpoint
UPDATE wallets w SET "agentId" = a.id FROM agents a WHERE w."ownerId" = a."ownerId" AND w.provider = 'privy';
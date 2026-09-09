CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" text NOT NULL,
	"walletId" uuid NOT NULL,
	"agentName" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "grants_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" text NOT NULL,
	"walletId" uuid NOT NULL,
	"grantId" uuid,
	"principalKey" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"requestHash" text NOT NULL,
	"input" jsonb NOT NULL,
	"operationHash" text NOT NULL,
	"policyVersion" integer NOT NULL,
	"status" text NOT NULL,
	"signedTransaction" text,
	"transactionHash" text,
	"receipt" jsonb,
	"error" text,
	"approvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" text NOT NULL,
	"provider" text NOT NULL,
	"providerWalletId" text NOT NULL,
	"address" text NOT NULL,
	"chainId" text NOT NULL,
	"policy" jsonb NOT NULL,
	"policyVersion" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_walletId_wallets_id_fk" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_walletId_wallets_id_fk" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_grantId_grants_id_fk" FOREIGN KEY ("grantId") REFERENCES "public"."grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_idempotency" ON "operations" USING btree ("principalKey","idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_provider_chain" ON "wallets" USING btree ("provider","providerWalletId","chainId");
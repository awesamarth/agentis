CREATE TABLE "onboarding" (
	"ownerId" text PRIMARY KEY NOT NULL,
	"networks" jsonb NOT NULL,
	"defaultNetwork" text NOT NULL,
	"completedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "authorizationRequest" jsonb;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "authorizationSignature" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
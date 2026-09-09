ALTER TABLE "onboarding" ADD COLUMN "totalBudgetUsdMicros" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "usdQuote" jsonb;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "usdReservedMicros" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "usdSettledMicros" text;
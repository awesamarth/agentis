CREATE TABLE uniswap_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "ownerId" text NOT NULL, "agentId" uuid NOT NULL REFERENCES agents(id), "walletId" uuid NOT NULL REFERENCES wallets(id), "grantId" uuid REFERENCES grants(id),
 "principalKey" text NOT NULL, "idempotencyKey" text NOT NULL, "requestHash" text NOT NULL, request jsonb NOT NULL, quote jsonb NOT NULL,
 "approvalId" uuid REFERENCES operations(id), "swapId" uuid REFERENCES operations(id), "paymentId" uuid REFERENCES operations(id), "fundingRequest" jsonb, "scheduleId" uuid, "scheduleVersion" integer,
 status text NOT NULL DEFAULT 'pending', error text, "createdAt" timestamptz NOT NULL DEFAULT now(), "expiresAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX uniswap_plan_key ON uniswap_plans ("principalKey", "idempotencyKey");
CREATE TABLE uniswap_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "ownerId" text NOT NULL, "agentId" uuid NOT NULL REFERENCES agents(id), "walletId" uuid NOT NULL REFERENCES wallets(id),
 request jsonb NOT NULL, "intervalMinutes" integer NOT NULL CHECK ("intervalMinutes" >= 5), kind text NOT NULL DEFAULT 'dca', "minimumGasAtomic" text,
 status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, "nextRunAt" timestamptz NOT NULL, "activePlanId" uuid REFERENCES uniswap_plans(id),
 "lastError" text, "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE uniswap_plans ADD FOREIGN KEY ("scheduleId") REFERENCES uniswap_schedules(id);
CREATE TABLE uniswap_setup_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "ownerId" text NOT NULL, "walletId" uuid NOT NULL REFERENCES wallets(id), "grantId" uuid REFERENCES grants(id),
 action text NOT NULL, "scheduleId" uuid REFERENCES uniswap_schedules(id), "scheduleVersion" integer, input jsonb, completed boolean NOT NULL DEFAULT false, "expiresAt" timestamptz NOT NULL
);

ALTER TABLE agents DROP CONSTRAINT agents_plugins_valid;
ALTER TABLE agents ADD CONSTRAINT agents_plugins_valid CHECK (jsonb_typeof(plugins) = 'array' AND plugins <@ '["uniswap","ens","erc8004"]'::jsonb AND jsonb_array_length(plugins) <= 3);
CREATE TABLE agent_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "agentId" uuid NOT NULL UNIQUE REFERENCES agents(id), "ownerId" text NOT NULL,
 "walletId" uuid NOT NULL REFERENCES wallets(id), name text NOT NULL UNIQUE, parent text NOT NULL, "parentOwner" text NOT NULL,
 registry text, resolver text NOT NULL, salt text NOT NULL, description text NOT NULL DEFAULT '', verified boolean NOT NULL DEFAULT false,
 "registrationOperationId" uuid REFERENCES operations(id), "createdAt" timestamptz NOT NULL DEFAULT now()
);

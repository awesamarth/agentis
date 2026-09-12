ALTER TABLE agents ADD COLUMN plugins jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agents ADD CONSTRAINT agents_plugins_valid CHECK (plugins IN ('[]'::jsonb, '["uniswap"]'::jsonb));

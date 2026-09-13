ALTER TABLE agents DROP CONSTRAINT agents_plugins_valid;
UPDATE agents SET plugins =
  (CASE WHEN plugins ? 'uniswap' THEN '["uniswap"]'::jsonb ELSE '[]'::jsonb END) ||
  (CASE WHEN plugins ? 'ens' OR plugins ? 'erc8004' THEN '["ens"]'::jsonb ELSE '[]'::jsonb END);
ALTER TABLE agents ADD CONSTRAINT agents_plugins_valid CHECK (
  plugins IN ('[]'::jsonb, '["uniswap"]'::jsonb, '["ens"]'::jsonb, '["uniswap","ens"]'::jsonb, '["ens","uniswap"]'::jsonb)
);

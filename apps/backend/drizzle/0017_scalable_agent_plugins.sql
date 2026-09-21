ALTER TABLE agents DROP CONSTRAINT agents_plugins_valid;
ALTER TABLE agents ADD CONSTRAINT agents_plugins_array CHECK (jsonb_typeof(plugins) = 'array');

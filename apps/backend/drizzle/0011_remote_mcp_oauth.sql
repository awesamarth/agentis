CREATE TABLE oauth_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, redirect_uris jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
 client_id uuid NOT NULL REFERENCES oauth_clients(id), resource text NOT NULL, grant_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE oauth_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES oauth_clients(id),
 redirect_uri text NOT NULL, challenge text NOT NULL, state text, resource text NOT NULL,
 expires_at timestamptz NOT NULL, code_hash text UNIQUE, connection_id uuid REFERENCES oauth_connections(id),
 completed_at timestamptz, consumed_at timestamptz
);
CREATE TABLE oauth_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES oauth_connections(id),
 token_hash text NOT NULL UNIQUE, kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX oauth_tokens_connection ON oauth_tokens(connection_id);
CREATE INDEX oauth_connections_owner ON oauth_connections(owner_id);

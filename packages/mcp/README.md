# Agentis MCP

Agentis MCP tools for remote Streamable HTTP and local stdio clients.

## Remote Worker

`src/worker.ts` is a stateless Cloudflare Worker endpoint:

- MCP endpoint: `/mcp`
- OAuth resource metadata: `/.well-known/oauth-protected-resource`
- authentication: OAuth 2.1 authorization code + PKCE
- token validation: backend `/oauth/introspect`

Build without deploying:

```sh
bun run build:worker
```

Before deployment, set the same secret on the backend and Worker:

```sh
# Backend
MCP_INTROSPECTION_SECRET=<secret>

# Cloudflare
wrangler secret put MCP_INTROSPECTION_SECRET
```

Update `AGENTIS_MCP_RESOURCE` in `wrangler.toml` if the deployed URL is not
`https://mcp.agentis.systems/mcp`.

## Local Stdio

```json
{
  "mcpServers": {
    "agentis": {
      "command": "agentis-mcp",
      "env": {
        "AGENTIS_ACCOUNT_KEY": "agt_user_..."
      }
    }
  }
}
```

Local stdio retains account-key authentication for compatibility. Agent API
keys are resolved internally and are not configured separately.

Set `AGENTIS_API_URL` only when targeting a local or staging backend. The default API is `https://api.agentis.systems`.

The server intentionally skips local encrypted-wallet vault signing for v1. Use the CLI for local-wallet operations.

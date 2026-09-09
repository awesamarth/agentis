# Agentis MCP (rewrite)

Local stdio is a thin SDK adapter exposing four tools: capabilities, request operation, get operation, list operations. No agent-facing approval, policy mutation or key-administration tools.

```sh
# Set AGENTIS_TOKEN to a scoped agt_exec_ grant in your private environment.
# AGENTIS_API_URL defaults to http://localhost:3001.
bun packages/mcp/src/index.ts
```

A pending operation returns a human approval URL. Unknown execution is not permission to submit a new payment. Preserve the same idempotency key on retry.

**Remote Worker returns 503 deliberately** until scoped OAuth is integrated with the new backend. No legacy tokens are forwarded or introspected. This is a working-tree change, not a production deployment.

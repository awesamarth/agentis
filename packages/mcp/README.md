# Agentis MCP

Local stdio MCP server for Agentis account-level tools.

## Usage

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

`AGENTIS_ACCOUNT_KEY` is the account key from the dashboard/CLI auth flow. Agent API keys are resolved internally from the account-owned agent list; they are not configured separately.

Set `AGENTIS_API_URL` only when targeting a local or staging backend. The default API is `https://api.agentis.xyz`.

The server intentionally skips local encrypted-wallet vault signing for v1. Use the CLI for local-wallet operations.

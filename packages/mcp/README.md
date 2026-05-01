# Agentis MCP

Local stdio MCP server for Agentis account-level tools.

## Usage

```json
{
  "mcpServers": {
    "agentis": {
      "command": "bun",
      "args": ["/Users/awesamarth/Desktop/code/agentis/packages/mcp/src/index.ts"],
      "env": {
        "AGENTIS_ACCOUNT_KEY": "agt_user_...",
        "AGENTIS_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

`AGENTIS_ACCOUNT_KEY` is the account key from the dashboard/CLI auth flow. Agent API keys are resolved internally from the account-owned agent list; they are not configured separately.

The server intentionally skips local encrypted-wallet vault signing for v1. Use the CLI for local-wallet operations.

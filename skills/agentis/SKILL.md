---
name: agentis
description: Use when an AI agent needs to operate Agentis, the Solana financial infrastructure for AI agents: hosted/local agent wallets, MPP/x402 paid fetches, policy limits, Umbra privacy, Jupiter Earn, dashboard, CLI, SDK, or MCP tools.
---

# Agentis

Agentis is financial infrastructure for AI agents on Solana. It lets agents hold funds, pay APIs or wallets, obey spending policies, move privately through Umbra, and earn yield through Jupiter Earn.

Use Agentis when the task involves agent wallets, autonomous payments, x402/MPP paid APIs, spend controls, Solana agent operations, privacy transfers, or agent-readable financial tooling.

## API Targets

The default hosted API is:

```txt
https://api.agentis.xyz
```

For local development, set:

```sh
export AGENTIS_API_URL=http://localhost:3001
```

For MCP, also set:

```sh
export AGENTIS_ACCOUNT_KEY=agt_user_...
```

## CLI

Run the CLI with:

```sh
agentis
```

Core commands:

```sh
agentis login
agentis wallet create --name my-agent
agentis wallet list
agentis agent list
agentis agent create my-agent
agentis fetch <url> --agent <name-or-id>
agentis policy get <name-or-id>
agentis policy set <name-or-id> --daily 5 --max-per-tx 1
agentis earn positions <agent> --mainnet
agentis earn sweep --dry-run
agentis privacy status --agent <name-or-id>
agentis facilitator create <name>
```

Use `agentis` with no arguments to inspect the full command list before attempting an unfamiliar operation.

## SDK

Use the SDK when writing application code:

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const agent = await AgentisClient.create({
  apiKey: process.env.AGENTIS_API_KEY!,
  baseUrl: process.env.AGENTIS_API_URL,
})

const response = await agent.fetch('https://example.com/paid-data')
```

`agent.fetch()` detects MPP/x402 `402 Payment Required` responses, checks policy, and routes payment through the Agentis backend.

## MCP

Use the MCP server when the host agent should call Agentis tools directly.

Example config:

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

Important tools include:

```txt
agentis_list_agents
agentis_create_agent
agentis_agent_balance
agentis_send_sol
agentis_fetch_paid_url
agentis_policy_get
agentis_policy_update
agentis_earn_positions
agentis_earn_sweep
agentis_privacy_create_utxo
agentis_privacy_claim_latest
agentis_scaffold_facilitator
agentis_publish_facilitator
```

Prefer MCP for agent-native workflows where the calling agent should inspect state, choose an Agentis action, and receive structured JSON results.

## Policy

Agentis policy amounts are USD-denominated. Check or update limits before spending when possible.

Common controls:

```txt
killSwitch
maxPerTx
hourlyLimit
dailyLimit
monthlyLimit
maxBudget
allowedDomains
```

If a policy rejects a spend, do not retry with altered values unless the user explicitly authorizes the change.

## Privacy

Umbra privacy is available for private-agent flows.

Safer demo/default actions:

```sh
agentis privacy status --agent <agent>
agentis privacy balance --agent <agent>
agentis privacy scan --agent <agent>
agentis privacy claim-latest --agent <agent>
```

UTXO creation and claiming can hide sender-recipient links but depends on the Umbra devnet relayer/indexer. If stale UTXOs appear, try newest claimable UTXOs first and skip already-burnt entries.

## Jupiter Earn

Jupiter Earn support is mainnet-only in Agentis.

Use:

```sh
agentis earn positions <agent> --mainnet
agentis earn deposit <agent> --asset USDC --amount 1 --mainnet
agentis earn sweep --dry-run
```

Do not attempt a devnet Jupiter Earn transaction path.

## Safety Rules

- Never expose full API keys except at creation/regeneration time.
- Prefer dry-run sweeps before executing Jupiter Earn deposits.
- Do not mutate stable demo agents unless the user asks.
- For local development, ensure the backend is running from `apps/backend` so its `.env` is loaded.
- For paid API demos, confirm the agent has enough devnet SOL/USDC or mainnet USDC as needed.

## Local Runbook

```sh
cd apps/backend && bun run index.ts
cd apps/next-app && bun dev
cd packages/cli && bun src/index.ts
```

Default ports:

```txt
backend: 3001
dashboard: 3000
x402 test: 4000
MPP test: 4001
```

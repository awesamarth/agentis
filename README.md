# Agentis

## Future Plans

Main things left now:

1. Jupiter Earn polish: sweep is implemented in the CLI for mainnet USDC; withdraw and dashboard positions UI can be added next.
2. Agentis skill file: so other agents can load “how to use Agentis” and operate CLI/MCP/dashboard correctly.
3. Facilitator polish: docs, cleaner generated README, seller onboarding/top-up UX, maybe dashboard/explore page.
4. Demo scripting: lock the exact Colosseum flow and make it reliable/repeatable.

Post-Colosseum:
- Production hardening: real DB, hashed API/account keys, better logs/observability, deployment config.
- On-chain policy for x402/MPP.

## Current Demo Status

- Jupiter Earn deposit, positions, and sweep are implemented for mainnet USDC.
- Umbra encrypted balance and UTXO/private-transfer flow both work on devnet wSOL/SOL.
- Umbra UTXO claim handling now skips stale already-burnt indexer entries and claims the newest available UTXO first.
- On-chain policy is implemented for direct SOL sends on devnet via the Quasar program.
- Kora-backed x402 facilitator scaffolding and local x402 end-to-end test are implemented.
- Local stdio MCP server is implemented in `packages/mcp` for account-key-controlled agent operations.

## MCP

Run the local MCP server from Codex/Claude-style MCP config:

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

It exposes hosted-agent tools for list/create/balance/send, paid fetch, policy, Umbra privacy, Jupiter Earn, sweep, transactions, CLI help, and facilitator metadata/scaffolding. Local encrypted-wallet vault signing remains CLI-only for now.

### SDK Product Split

The Agentis SDK should be treated as a server-side / agent-runtime SDK, not a browser SDK. Agent API keys belong to agent wallets and must stay on a developer backend or inside a trusted agent runtime.

Expected runtime flow:

```txt
User
  -> developer app/backend
    -> developer agent runtime / server job
      -> Agentis SDK with agent API key
        -> Agentis backend
          -> agent wallet signs/pays
```

For apps that create one Agentis agent per user, the developer should store the mapping server-side:

```txt
userId -> agentisAgentId/apiKey
```

Example: an AI research assistant that pays for search, scraping, enrichment, or x402/MPP data APIs.

```ts
const agent = await AgentisClient.create({
  apiKey: user.agentisApiKey,
  baseUrl: process.env.AGENTIS_URL,
})

const allowed = await agent.policy.check({
  amountUsd: 0.05,
  url: 'https://paid-search-api.com/query',
})

if (!allowed.allowed) throw new Error(allowed.reason)

const res = await agent.fetch('https://paid-search-api.com/query?q=helius')
const data = await res.json()
```

Direct payment:

```ts
await agent.pay('freelancer-wallet-address', 0.1)
```

This suggests a clean long-term split:

```txt
@agentis/sdk
  Runtime SDK for one agent:
  fetch, pay, balance, policy.check, privacy

@agentis/admin or backend API
  App/developer control plane:
  create agents, list agents, rotate keys, set policy, fund links
```

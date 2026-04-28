# Agentis

## Future Plans

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


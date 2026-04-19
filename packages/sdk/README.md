# @agentis/sdk

AI agent payment infrastructure for Solana. Drop-in `fetch` replacement that silently handles MPP/x402 payments, enforces spending policies, and signs transactions via your Agentis agent wallet.

## Install

```bash
npm install @agentis/sdk
```

## Usage

```typescript
import { AgentisClient } from '@agentis/sdk'

const agentis = await AgentisClient.create({
  apiKey: 'agt_live_xxxx',        // from Agentis Dashboard
})

// Drop-in fetch replacement — handles 402 silently
const res = await agentis.fetch('https://api.dune.com/some/paid/endpoint')
const data = await res.json()
```

## Policy management

```typescript
// Get current policy
const policy = await agentis.policy.get()

// Update policy
await agentis.policy.update({
  dailyLimit: 0.1,
  maxPerTx: 0.01,
  allowedDomains: ['api.dune.com', 'api.openai.com'],
})
```

## Options

```typescript
const agentis = await AgentisClient.create({
  apiKey: 'agt_live_xxxx',
  simulate: true,              // dry run — logs payments, no real transactions
  autoEarn: true,              // auto-deposit idle funds to Jupiter Earn (coming soon)
  onPayment: (details) => {
    console.log(`Paid ${details.amount} ${details.currency} to ${details.recipient}`)
  },
})
```

## Server-side paywall

Turn any endpoint into a paid endpoint:

```typescript
// app/api/data/route.ts (Next.js)
import { paywall } from '@agentis/sdk/server'

export const GET = paywall(
  { fee: 0.001, receiver: 'YourSolanaWallet' },
  async (req) => {
    return Response.json({ data: 'premium content' })
  }
)
```

```typescript
// Hono
import { honoPaywall } from '@agentis/sdk/server'
app.use('/api/data', honoPaywall({ fee: 0.001, receiver: 'YourSolanaWallet' }))
```

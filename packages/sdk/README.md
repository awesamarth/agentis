# @agentis-hq/sdk

AI agent payment infrastructure for Solana. Drop-in `fetch` replacement that silently handles MPP/x402 payments, enforces spending policies, and signs transactions via your Agentis agent wallet.

## Install

```bash
npm install @agentis-hq/sdk
```

## Usage

```typescript
import { AgentisClient } from '@agentis-hq/sdk'

const agentis = await AgentisClient.create({
  apiKey: 'agt_live_xxxx',        // from Agentis Dashboard
})

// Paid HTTP/x402/MPP endpoints — handles 402 silently
const res = await agentis.fetch('https://api.dune.com/some/paid/endpoint')
const data = await res.json()

// Direct wallet payments
const signature = await agentis.pay('recipient-solana-address', 0.01)

// Balances
const balances = await agentis.balance()
const sol = await agentis.balance('So11111111111111111111111111111111111111112')
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

Turn any endpoint into an MPP and/or x402 paid endpoint. Amounts are atomic
token units: for USDC/USDT, `1000` means `0.001` token; for SOL, `10000`
means `10000` lamports.

```typescript
// app/api/data/route.ts (Next.js)
import { paywall } from '@agentis-hq/sdk/server'

export const GET = paywall(
  {
    protocol: 'both',
    asset: 'usdc',
    amount: '1000',
    recipient: 'YourSolanaWallet',
  },
  async (req) => {
    return Response.json({ data: 'premium content' })
  }
)
```

```typescript
// Hono
import { honoPaywall } from '@agentis-hq/sdk/server'
app.use('/api/data', honoPaywall({
  protocol: 'x402',
  asset: 'usdc',
  amount: '1000',
  recipient: 'YourSolanaWallet',
}))
```

Supported Solana devnet assets:

- MPP: native SOL, USDC, and USDT/SPL-compatible token mints.
- x402: SPL tokens through the x402 SVM exact scheme. USDC and USDT are
  supported; native SOL is intentionally MPP-only unless wrapped as an SPL asset
  and supported by your facilitator.

The server helpers use standard protocol headers: MPP uses
`WWW-Authenticate`, `Authorization`, and `Payment-Receipt`; x402 v2 uses
`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`.

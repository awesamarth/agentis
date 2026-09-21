# Agentis SDK

Thin TypeScript HTTP client. Use `new AgentisClient({baseUrl, token})`; token can be an async getter for a fresh Privy JWT. Agents receive only scoped `agt_exec_` grants.

Install with `bun add @agentis-hq/sdk@0.3.0`.

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const client = new AgentisClient({
  baseUrl: 'https://api.agentis.systems',
  token: process.env.AGENTIS_TOKEN!,
})
const result = await client.operations.create({
  walletId, action: 'transfer', chainId: 'eip155:84532', asset: 'native',
  to, amountAtomic: '1000', maxFeeAtomic: '1000000000000000', reason: 'Agent payment',
}, { idempotencyKey: 'stable-task-id' })
```

`operations.get/list/wait` return state/receipt; `wait` stops at pending approval or unknown outcome. Owner clients can `operations.approve(id, operationHash)` / `reject`, `wallets.link/setPolicy`, and `grants.create/list/revoke`.

Owner-only `agents.pause(id)` stops new payments and invalidates unsubmitted approvals for that agent; already-issued transactions still reconcile. Owner-only `wallets.exportKey(id, { confirm: true })` requires an authenticated owner and verified user + server quorum, then uses the server authorization key to export. It returns a sensitive private key: never log, cache, or persist it unintentionally. This is the explicit default, not a fallback after user authorization fails.

For `grants.create`, supply `agentId` and `agentName`. Keys have no expiry by default and remain valid until revoked. An optional future `expiresAt` may be supplied, with no 30-day cap; existing explicit expiries remain unchanged. Omit `chainIds` for all enabled networks, including future additions; supply a non-empty, unique `chainIds` array to restrict the key to selected enabled networks. Restricted keys do not automatically include newly added networks. Legacy `walletId` scope remains supported instead of `agentId`, without `chainIds`; existing keys keep their scope. Agent keys can call `wallets.list()` to discover only their enabled wallets; neither scope permits settings changes, creating keys or self-approval.

No local policy bypass, signing, USD guessing or automatic payment retries. Hosted Privy execution, x402/MPP paid fetch, Uniswap and ENS methods use the common backend. Mainnet is unsupported. The SDK is a transport client and has no mandatory chain or seller-paywall dependencies.

Build locally with `bun run build:packages` at repo root. Version 0.3.0 exposes the V2 API. See the [project README](https://github.com/awesamarth/agentis#readme) for networks, plugins and examples.

# Agentis SDK

Thin TypeScript HTTP client. Use `new AgentisClient({baseUrl, token})`; token can be an async getter for a fresh Privy JWT. Agents receive only scoped `agt_exec_` grants.

Install with `bun add @agentis-hq/sdk@0.5.0`.

## Documentation

- [SDK setup and quickstart](https://docs.agentis.systems/docs/sdk)
- [Wallets, balances and policies](https://docs.agentis.systems/docs/sdk/wallets)
- [Transfers, discovery and paid APIs](https://docs.agentis.systems/docs/sdk/payments)
- [Operations, approvals, receipts and errors](https://docs.agentis.systems/docs/sdk/operations)
- [Owner administration and access keys](https://docs.agentis.systems/docs/sdk/administration)
- [Uniswap and ENS](https://docs.agentis.systems/docs/sdk/plugins)
- [Card purchases and browser checkout](https://docs.agentis.systems/docs/sdk/cards)

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

Owner-only `agents.pause(id)` stops new payments and invalidates unsubmitted approvals for that agent; already-issued transactions still reconcile. Owner-only `wallets.exportKey(id, { confirm: true })` requires an authenticated owner and verified user + server quorum, then uses the server authorization key to export. It returns a sensitive private key: never log, cache, or persist it unintentionally. Keep this capability in an owner-controlled interface, never an agent tool.

For `grants.create`, supply `agentId` and `agentName`. Keys have no expiry by default and remain valid until revoked. An optional future `expiresAt` may be supplied, with no 30-day cap; existing explicit expiries remain unchanged. Omit `chainIds` for all enabled networks, including future additions; supply a non-empty, unique `chainIds` array to restrict the key to selected enabled networks. Restricted keys do not automatically include newly added networks. Legacy `walletId` scope remains supported instead of `agentId`, without `chainIds`; existing keys keep their scope. Agent keys can call `wallets.list()` to discover only their enabled wallets; neither scope permits settings changes, creating keys or self-approval.

No local policy bypass, signing, USD guessing or automatic payment retries. Hosted Privy execution, x402/MPP paid fetch, Uniswap and ENS methods use the common backend. Core network support comes from backend capabilities; ENS and Uniswap remain on their existing testnet deployments. The SDK does not require local wallet keys or a seller-paywall integration.

## Public API discovery

```ts
const catalog = new AgentisClient({ baseUrl: 'https://api.agentis.systems' })
await catalog.discovery.search({ query: 'web search', limit: 3 })
await catalog.discovery.describe('exa')
```

No token required; these methods do not invoke a configured token getter or send Authorization. Mercator catalog data is advisory and cannot authorize payment. Existing `client.fetch` pays the chosen provider directly through normal policy/approval.

## Paid HTTP

`client.fetch` accepts `method` (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS), provider `headers`, and either `body` (exact UTF-8 text) or `bodyBase64` (exact binary or multipart bytes). The default method is GET; GET/HEAD cannot carry bodies. Set Content-Type to match the provider—requests are not restricted to JSON. Method, headers and body are bound to the operation's approval and idempotency key. Caller-supplied payment credentials and unsafe transport headers are rejected.

Tempo MPP charge supports agent-paid and provider-sponsored gas. `maxFeeAtomic: '0'` selects sponsored offers; the agent reserves and pays only the API charge. Sponsorship does not bypass policy/approval or authorize a new payment after uncertainty.

Tempo push-only offers use the same `fetch` API and require a positive fee ceiling. `operation.mpp.mode` records the selected mode; dual-mode offers prefer pull. Agentis persists signed proof before broadcasting, confirms settlement, then delivers hash credentials. Payment can succeed even when provider HTTP fails; same-key retries do not pay again or automatically re-request the result. Provider sponsorship remains pull-only.

Solana MPP charges use the same `fetch` API: USDC by default, or `asset: 'SOL'` for native payments. SOL amounts and `maxFeeAtomic` use lamports (9 decimals); USDC uses 6 decimals. Agent-paid fees include possible recipient ATA rent; sponsored offers bind zero agent fees. Tempo/Solana MPP provider splits are persisted in `operation.mpp.splits`; `amountAtomic` is the entire charge, with the primary share equal to total minus splits. All recipients pass policy/approval checks; Solana ATA rent is reserved per distinct recipient. Existing Solana/Base x402 is preserved.

## Agentcard purchases

Enable the optional Agentcard plugin for the agent, connect the owner's Vault in the dashboard, and explicitly grant this runtime's key card permission. Crypto permission alone is insufficient.

```ts
const turn = await client.cards.purchases.ask({
  agentId,
  ask: 'Find a notebook under $10. Do not purchase yet.',
}, { idempotencyKey: 'notebook-cart-001' })
// Inspect turn.carts and choose the intended cart before confirming.
```

`client.cards.purchases.confirm({ agentId, conversationId: turn.id, cartHash: selectedCart.hash }, { idempotencyKey })` requests the exact reviewed cart and can immediately place an order in Auto mode. Ask returns an owner approval link. `client.cards.checkouts.execute(id)` submits an already-authorized purchase; it does not approve. Read the original request with `client.cards.checkouts.get(id)` and the shopping turn with `client.cards.purchases.conversation(turn.id)`.

Use `client.cards.purchases.continue(id)` only after a known-unpaid Agentcard approval pause, never after an unknown charge or timeout. `client.cards.checkouts.cancel(id)` requests cancellation but is not a merchant order cancellation/refund. Card requests use checkout IDs, not crypto operation IDs, and share the agent's USD budget. Agentcard/issuer approvals still apply.

### Browser adapter

```ts
import { createCardCheckoutContext } from '@agentis-hq/sdk/cards/browser'

const { context, page, controller } = await createCardCheckoutContext(browser, {
  client, agentId, merchant: 'Selected merchant', amountMinor: 1000,
  idempotencyKey: 'browser-purchase-001',
  onApprovalUrl: url => { /* Show privately to owner; never log. */ },
})
```

Supply a Playwright Chromium `browser` (install Playwright separately). The helper creates a context with service workers blocked and attaches the official Agentcard SDK. Drive shopping with the returned `page`; keep the context alive through approval and merchant completion, then close it. `attachCardCheckout(page, options)` also supports an existing page in a service-worker-blocked context. `cardCheckoutPlaceholder` exports dummy form values for supported interception—not real card details.

One adapter handles one purchase attempt. Never log captures/replay credentials, put Agentcard organization secrets in the harness, or automatically repeat an uncertain checkout. Verify the merchant order separately from payment. Not every processor is supported; prepared/native-checkout and future-spend APIs are not exposed. Reusable browser credentials and issuer fees are outside hard spending-enforcement claims; use a trusted harness.

See the [Agentcard guide](https://docs.agentis.systems/docs/agentis/agentcard) and [card SDK examples](https://docs.agentis.systems/docs/sdk/cards). Build locally with `bun run build:packages` at repo root. See the [project README](https://github.com/awesamarth/agentis#readme) for networks and plugins.

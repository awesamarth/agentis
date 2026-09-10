# Agentis SDK (rewrite)

Thin TypeScript HTTP client. Use `new AgentisClient({baseUrl, token})`; token can be an async getter for a fresh Privy JWT. Agents receive only scoped `agt_exec_` grants.

```ts
const result = await client.operations.create({
  walletId, action: 'transfer', chainId: 'eip155:31337', asset: 'native',
  to, amountAtomic: '1000', maxFeeAtomic: '1000000000000000', reason: 'Local test',
}, { idempotencyKey: 'stable-task-id' })
```

`operations.get/list/wait` return state/receipt; `wait` stops at pending approval or unknown outcome. Owner clients can `operations.approve(id, operationHash)` / `reject`, `wallets.link/setPolicy`, and `grants.create/list/revoke`.

For `grants.create`, supply exactly one of `agentId` (all enabled networks, including networks added later) or `walletId` (one network wallet), plus `agentName` and `expiresAt` (within 30 days). Existing wallet keys keep their scope. Agent keys can call `wallets.list()` to discover only their enabled wallets; neither scope permits settings changes, creating keys or self-approval.

No local policy bypass, signing, USD guessing or automatic payment retries. Mainnet/Privy execution and paid-fetch plugins are unavailable pending verification. SDK main entry has no mandatory chain library; retained `/server` paywall helpers are separate seller-side fixtures, not the removed Agentis facilitator product. Only `/server` consumers need its optional peers: `@solana/mpp`, `@x402/core`, `@x402/svm` and `mppx` (use the compatible ranges in package.json).

Build locally with `bun run build:packages` at repo root. Published package versions do not yet represent this rewrite. See root README and `docs/architecture.md`.

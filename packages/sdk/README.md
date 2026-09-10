# Agentis SDK (rewrite)

Thin TypeScript HTTP client. Use `new AgentisClient({baseUrl, token})`; token can be an async getter for a fresh Privy JWT. Agents receive only scoped `agt_exec_` grants.

```ts
const result = await client.operations.create({
  walletId, action: 'transfer', chainId: 'eip155:31337', asset: 'native',
  to, amountAtomic: '1000', maxFeeAtomic: '1000000000000000', reason: 'Local test',
}, { idempotencyKey: 'stable-task-id' })
```

`operations.get/list/wait` return state/receipt; `wait` stops at pending approval or unknown outcome. Owner clients can `operations.approve(id, operationHash)` / `reject`, `wallets.link/setPolicy`, and `grants.create/list/revoke`.

Owner-only `agents.pause(id)` stops new payments and invalidates unsubmitted approvals for that agent; already-issued transactions still reconcile. Owner-only `wallets.exportKey(id, { confirm: true })` requires Privy user authorization and returns a sensitive private key: never log, cache, or persist it unintentionally. It does not fall back to the server signer if user authorization fails.

For `grants.create`, supply `agentId` and `agentName`. Keys have no expiry by default and remain valid until revoked. An optional future `expiresAt` may be supplied, with no 30-day cap; existing explicit expiries remain unchanged. Omit `chainIds` for all enabled networks, including future additions; supply a non-empty, unique `chainIds` array to restrict the key to selected enabled networks. Restricted keys do not automatically include newly added networks. Legacy `walletId` scope remains supported instead of `agentId`, without `chainIds`; existing keys keep their scope. Agent keys can call `wallets.list()` to discover only their enabled wallets; neither scope permits settings changes, creating keys or self-approval.

No local policy bypass, signing, USD guessing or automatic payment retries. Mainnet/Privy execution and paid-fetch plugins are unavailable pending verification. SDK main entry has no mandatory chain library; retained `/server` paywall helpers are separate seller-side fixtures, not the removed Agentis facilitator product. Only `/server` consumers need its optional peers: `@solana/mpp`, `@x402/core`, `@x402/svm` and `mppx` (use the compatible ranges in package.json).

Build locally with `bun run build:packages` at repo root. Published package versions do not yet represent this rewrite. See root README and `docs/architecture.md`.

# Network configuration

`packages/core/src/networks.ts` is the developer-owned catalog used by the backend, CLI and MCP. The dashboard and SDK consume its public metadata from the backend. Users select supported networks; they do not supply custom chain definitions.

## Add a network

Add a catalog entry with its stable key, CAIP chain ID, environment, supported execution family, native/protocol fee units, asset contracts and decimals, fresh-price IDs, RPC configuration and explorer. Solana entries also require the full genesis hash; EVM entries use a viem chain definition.

Enable a payment rail only when its exact contracts are supported:

- x402: token, operation asset, atomic-unit scale and EIP-3009 domain where applicable.
- MPP: Tempo network, explicit payment-token allowlist and fee eligibility. New operations persist an independent fee asset; historical implicit fees retain their original identity. See [Tempo support](tempo.md).
- Alchemy Portfolio: optional supported network slug; other networks use direct RPC reads.

A new network using an existing adapter is primarily configuration. A new execution family, token standard or payment protocol still needs explicit validation, signing and reconciliation code. Never infer those capabilities from a network name.

Mainnet aliases are `base`, `ethereum`, `tempo` and `solana`. Testnet aliases are `base-sepolia`, `sepolia`, `arc`, `tempo-testnet` and `solana-devnet`. Mainnet and testnet budgets use the same configured limits but independent usage. Display estimates never authorize spending.

## Retire a network

Set `enabled: false` on its catalog entry. It disappears from new selections, capabilities and balance RPC reads, and new execution is rejected. Retain the entry's historical chain ID, environment, assets and RPC configuration: pending submissions must still reconcile, and historical mainnet spending must stay accounted for. Do not delete catalog entries that have payment history or uncertain submissions.

A retired network does not revoke already-issued signatures or undo submitted payments. Review pending operations before removing RPC access.

## Validate

- `bun run check`
- `bun test testing/networks.test.ts testing/display-prices.test.ts`
- `bun testing/local-wallet-check.ts`
- `bun testing/local-policy-check.ts`
- `bun testing/hosted-view-check.ts`
- `bun testing/x402-settlement-check.ts`
- With a dedicated local `DATABASE_URL` on port 55432: `bun testing/network-accounting-check.ts` and `bun testing/remote-mcp-check.ts`. These create isolated temporary schemas and never sign or broadcast.

Mainnet execution is configured but has not been live-verified. Base's L1 fee allowance uses a conservative estimate with headroom, not a protocol-enforced upper bound against future fee changes. ENS and Uniswap remain pinned to their existing testnets; their implementation/deployment configuration is separate and unchanged.

The local CLI wallet format is v4. Older private wallet files are left untouched and rejected rather than silently reinterpreting old testnet aliases as mainnet consent. There is no automatic migration.

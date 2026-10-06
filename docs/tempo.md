# Tempo payments

## Scope and verification

Agentis supports **transfers and unsponsored, one-shot MPP `charge` payments in pull mode** on Tempo mainnet (4217) and Moderato testnet (42431). Hosted dashboard, SDK, CLI and MCP use the same backend policy/approval pipeline; local CLI custody remains separate.

This does **not** imply support for MPP sessions, subscriptions, sponsored charges, split payments, bridges, automatic swaps or arbitrary TIP-20 tokens. Unsupported offers are rejected, never silently substituted. Existing ENS/Uniswap deployments are unchanged.

## Explicit token catalog

| Token | Mainnet | Testnet |
| --- | --- | --- |
| OUSD (Open USD) | `0x20c0000000000000000000006a37da5c996874be` | Same address, separate test token |
| USDC.e (Stargate bridged USDC) | `0x20c000000000000000000000b9537d11c60e8b50` | `0x20c0000000000000000000009e8d7eb59b783726` |
| pathUSD | `0x20c0000000000000000000000000000000000000` | Same address, separate test token |
| alphaUSD | Not supported | `0x20c0000000000000000000000000000000000001` |

All use six token decimals. **BetaUSD and thetaUSD are deliberately excluded.** OUSD is the default for new selections, in line with Tempo's current guidance. It is Open USD, not the unrelated Origin Dollar ticker. Existing wallet/network settings are not rewritten.

## Payment currency and fee currency

Every new Tempo operation persists a `feeAsset` before approval. It defaults to the payment asset when fee-eligible, but may be a different eligible Tempo token. **Testnet USDC.e is denominated `USDC`, not `USD`, on-chain and cannot pay gas.** Its creation-time fee default is OUSD; this is persisted and shown before approval. Mainnet USDC.e is fee-eligible. The operation hash binds both. A change requires a new approval, not alteration of a pending payment.

`amountAtomic` uses six decimals. `maxFeeAtomic` remains in **18-decimal Tempo protocol fee units**. For example, `10000000000000000` caps gas exposure at 0.01 fee tokens. Protocol gas is rounded upward to whole six-decimal token units. USD budgeting values those actual tokens at the selected fee token's fresh price, separately from the payment currency.

Preparation checks exact chain identity, supported fee-token metadata, balance for payment plus maximum signed fees, and gas estimation. Gas estimation checks the current fee-liquidity/policy state; it cannot guarantee liquidity across future state changes. No silent fee-token fallback or swap is performed. Receipts include the actual fee-token ID, atomic amount and decimals, and successful transactions must contain the approved transfer event.

Older persisted operations without `feeAsset` retain their original pathUSD mainnet / alphaUSD testnet fee semantics. New defaults never reinterpret old authorizations. Unknown submissions keep their reservations and original proof; expiration alone is not proof that a transaction was unused. Automatic recovery/release for uncertain Tempo transactions remains deferred.

## Interfaces

SDK/raw operation example (request only; follow the normal approval flow):

```ts
client.operations.create({
  walletId, action: 'transfer', chainId: 'eip155:4217',
  asset: 'erc20:0x20c0000000000000000000006a37da5c996874be', // OUSD
  feeAsset: 'erc20:0x20c0000000000000000000000000000000000000', // pathUSD
  to: recipient, amountAtomic: '1000', maxFeeAtomic: '10000000000000000',
}, { idempotencyKey })
```

For `client.fetch`, optional `asset` and `feeAsset` accept exact supported token symbols or IDs. MPP discovery chooses an eligible offer in catalog preference order (OUSD first), or only the explicitly requested token. It does not probe balances to choose another currency. Only the selected challenge is persisted, with its amount, recipient, chain, expiry and optional memo. Descriptive metadata carries no execution authority; unknown financial extensions fail closed.

CLI sends and paid fetches accept `--asset` and Tempo-only `--fee-asset`. MCP `agentis_send` and `agentis_fetch` expose matching choices. Dashboard transfers expose a fee-token selector. Approval/history views show payment and fee currencies separately. Reuse the exact original request/idempotency key after uncertainty.

## Spending prices (not display assumptions)

Pricing is shared between hosted and local execution:

- **OUSD:** CoinGecko's `open-usd` direct price API, retaining its original `last_updated_at`. Its DefiLlama mirror was observed lagging. Quotes older than five minutes, future-dated over 30 seconds, non-positive or malformed fail closed.
- **pathUSD:** RedStone `pathUSD` signed production data packages.
- **USDC.e:** RedStone's canonical **USDC** price feed, matching the underlying-asset valuation used by Tempo's oracle/token metadata. This is **not** an independent assertion of Stargate bridge solvency or of a bridged-token discount.
- **Testnet:** explicit synthetic test-USD valuation, separate from mainnet budgets. It cannot price mainnet assets.

RedStone verification recovers cryptographic signers against a pinned production registry (three distinct trusted signers minimum), checks the exact signed feed and integer value, rejects packages older than 60 seconds or more than five seconds in the future, and rejects signer disagreement over 1%. Quorum does not prove independent economic data sources; feed methodology, provider availability and peg/bridge risks remain external dependencies.

Spending price caches last at most 30 seconds and never outlive source freshness. Oracle failures do not fall back to $1 or a stale quote. Display caching remains separate and cannot authorize spending.

The fixed public RedStone snapshot contains all feeds (~2 MiB); its credential-free reader is capped at 4 MiB. Paid HTTP retains its original 1 MiB limit, DNS/SSRF restrictions, redirect rejection and timeouts.

## Validation commands

- `bun run check` — builds and typechecks.
- `bun run check:offline` — curated regression checks, including oracle signature/quorum attacks, offer selection, exact terms and receipt evidence. `testing/tempo-signing-check.ts` additionally exercises the installed MPP client with fake RPC/signing and checks the signing boundary against changed fields.
- `testing/tempo-accounting-check.ts` — isolated local Postgres with a fake executor: independent fee pricing, owner approval, idempotency, proof-before-submit, uncertain submission retention/no resend, settlement and expiry.
- From `apps/backend`: `bun ../../testing/tempo-readonly-check.ts` — explicit live RPC/token/oracle checks and unpaid seller discovery. Does not sign or submit.

Read-only checks and fake-executor tests are not proof of live custody/signing/settlement. Mainnet spending requires explicit owner authorization; the owner performs the live mainnet test.

## Official references

- [OUSD and supported legacy currencies](https://tempo.xyz/developers/docs/guide/ousd)
- [Mainnet token registry](https://tokenlist.tempo.xyz/list/4217) / [Testnet registry](https://tokenlist.tempo.xyz/list/42431)
- [Fee specification](https://tempo.xyz/developers/docs/protocol/fees/spec-fee)
- [Tempo oracle providers](https://tempo.xyz/developers/docs/ecosystem/data-analytics)
- [RedStone Tempo feeds](https://app.redstone.finance/push-feeds?networks=tempo&testnets=true)
- [RedStone SDK verification documentation](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/README.md)

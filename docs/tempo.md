# Tempo payments

## Scope and verification

Agentis supports **transfers and one-shot MPP `charge` payments in pull mode, with agent-paid or provider-sponsored gas** on Tempo mainnet (4217) and Moderato testnet (42431). Hosted dashboard, SDK, CLI and MCP use the same backend policy/approval pipeline; local CLI custody remains separate.

**Full Tempo compatibility remains a goal, not a completed claim.** Remaining MPP gaps include sessions, subscriptions, push-only offers and split payments. They require their own authorization/accounting lifecycles; current unsupported offers fail explicitly rather than being silently substituted. Bridges, automatic swaps and arbitrary TIP-20 tokens are not included. Existing ENS/Uniswap deployments are unchanged.

## Explicit token catalog

| Token | Mainnet | Testnet |
| --- | --- | --- |
| OUSD (Open USD) | `0x20c0000000000000000000006a37da5c996874be` | Same address, separate test token |
| USDC.e (Stargate bridged USDC) | `0x20c000000000000000000000b9537d11c60e8b50` | `0x20c0000000000000000000009e8d7eb59b783726` |
| pathUSD | `0x20c0000000000000000000000000000000000000` | Same address, separate test token |
| alphaUSD | Not supported | `0x20c0000000000000000000000000000000000001` |

All use six token decimals. **BetaUSD and thetaUSD are deliberately excluded.** OUSD is the default for new selections, in line with Tempo's current guidance. It is Open USD, not the unrelated Origin Dollar ticker. Existing wallet/network settings are not rewritten.

## Payment currency and fee currency

Every new agent-paid-gas Tempo operation persists a `feeAsset` before approval. It defaults to the payment asset when fee-eligible, but may be a different eligible Tempo token. **Testnet USDC.e is denominated `USDC`, not `USD`, on-chain and cannot pay gas.** Its creation-time fee default is OUSD; this is persisted and shown before approval. Mainnet USDC.e is fee-eligible. The operation hash binds both. A change requires a new approval, not alteration of a pending payment.

`amountAtomic` uses six decimals. `maxFeeAtomic` remains in **18-decimal Tempo protocol fee units**. For example, `10000000000000000` caps gas exposure at 0.01 fee tokens. Protocol gas is rounded upward to whole six-decimal token units. USD budgeting values those actual tokens at the selected fee token's fresh price, separately from the payment currency.

Preparation checks exact chain identity, supported fee-token metadata, balance for payment plus maximum signed fees, and gas estimation. Gas estimation checks the current fee-liquidity/policy state; it cannot guarantee liquidity across future state changes. No silent fee-token fallback or swap is performed. Receipts include the actual fee-token ID, atomic amount and decimals, and successful transactions must contain the approved transfer event.

Older persisted operations without `feeAsset` retain their original pathUSD mainnet / alphaUSD testnet fee semantics. New defaults never reinterpret old authorizations. Unknown submissions keep their reservations and original proof; expiration alone is not proof that a transaction was unused. MPP lost-response recovery searches payment memo logs from the saved preparation block and verifies the exact sender proof. Automatic release of provably unused expired reservations remains unimplemented.

## Provider-sponsored gas

A challenge advertising `feePayer: true` creates an operation with `mpp.sponsored: true` and `maxFeeAtomic: "0"`. Only the API charge is reserved against the agent. No agent gas-token balance or fee-token USD valuation is required. RPC gas estimation still constructs the sponsored transaction. The sponsor—not the agent—selects and pays for its fee token.

The sender signs the Tempo sponsorship payload, binding the exact transfer, chain, nonce and validity window. The installed Privy transaction formatter drops the sponsorship marker, so hosted signing uses Privy's `signSecp256k1` only for that constructed and validated payload. The MPP client never receives an unrestricted raw-hash signer.

The sponsor adds its signature, changing the final transaction hash. Agentis stores the sender proof before submission, captures `Payment-Receipt` references before reading the response body, and checks the final on-chain sender payload/signature plus sponsor signature. Without an HTTP receipt, memo-log recovery finds candidate transactions and applies the same proof checks. The sponsor cannot be the agent itself; sponsor-paid gas settles as zero agent fees. Neither a response timeout nor an expired challenge permits a new payment.

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

Paid HTTP accepts GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS, provider headers, and either exact UTF-8 `body` or binary `bodyBase64` (including multipart encodings). Set `Content-Type` to the provider's format. There is no JSON-only restriction or 24 KiB outbound body cap. Deployment request-size limits still apply. The method, body and headers are persisted and bound to approval/idempotency; GET/HEAD have no body. The request defaults to GET when omitted. MPP also supports the `Payment-Authorization` field for sellers requiring separate application authentication.

```ts
client.fetch({
  walletId, url: 'https://api.exa.ai/search', method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'Tempo documentation', type: 'instant', numResults: 1 }),
  asset: 'USDC.e', maxAmountAtomic: '10000', maxFeeAtomic: '0',
}, { idempotencyKey }) // Request only; sponsored offers only with a zero fee ceiling.
```

CLI: `--method/-X`, repeatable `--header/-H`, `--data/-d` or `--data-file` (exact bytes). Supplying data defaults to POST. MCP exposes the same method/header/body choices. Approval UI exposes the persisted request and sponsorship status.

CLI sends and paid fetches accept `--asset` and Tempo-only `--fee-asset`. MCP `agentis_send` and `agentis_fetch` expose matching choices. Dashboard transfers expose a fee-token selector. Approval/history views show payment and fee currencies separately. Reuse the exact original request/idempotency key after uncertainty.

## Spending prices (not display assumptions)

Pricing is shared between hosted and local execution:

- **OUSD:** CoinGecko's `open-usd` direct price API, retaining its original `last_updated_at`. Its DefiLlama mirror was observed lagging. Quotes older than five minutes, future-dated over 30 seconds, non-positive or malformed fail closed.
- **pathUSD:** RedStone `pathUSD` signed production data packages.
- **USDC.e:** RedStone's canonical **USDC** price feed, matching the underlying-asset valuation used by Tempo's oracle/token metadata. This is **not** an independent assertion of Stargate bridge solvency or of a bridged-token discount.
- **Testnet:** explicit synthetic test-USD valuation, separate from mainnet budgets. It cannot price mainnet assets.

RedStone verification recovers cryptographic signers against a pinned production registry (three distinct trusted signers minimum), checks the exact signed feed and integer value, rejects packages older than 60 seconds or more than five seconds in the future, and rejects signer disagreement over 1%. Quorum does not prove independent economic data sources; feed methodology, provider availability and peg/bridge risks remain external dependencies.

Spending price caches last at most 30 seconds and never outlive source freshness. Oracle failures do not fall back to $1 or a stale quote. Display caching remains separate and cannot authorize spending.

The fixed public RedStone snapshot contains all feeds (~2 MiB); its credential-free reader is capped at 4 MiB. Paid HTTP accepts up to 10 MiB of raw response bytes (before base64 encoding), with DNS/SSRF restrictions, redirect rejection and the 20-second HTTP deadline unchanged. Larger responses still fail without releasing uncertain payments or automatically resending.

## Validation commands

- `bun run check` — builds and typechecks.
- `bun run check:offline` — curated regression checks, including oracle signature/quorum attacks, offer selection, exact terms and receipt evidence. `testing/tempo-signing-check.ts` additionally exercises the installed MPP client with fake RPC/signing and checks the signing boundary against changed fields, sponsored final-hash changes and lost-response recovery. `testing/paid-http.test.ts` covers application methods and exact non-JSON/binary bodies above the former cap.
- `testing/tempo-accounting-check.ts` — isolated local Postgres with a fake executor: independent fee pricing, owner approval, idempotency, proof-before-submit, uncertain submission retention/no resend, settlement and expiry.
- From `apps/backend`: `bun ../../testing/tempo-readonly-check.ts` — explicit live RPC/token/oracle checks and unpaid seller discovery. Does not sign or submit.

Read-only checks and fake-executor tests are not proof of live custody/signing/settlement. A separately owner-authorized mainnet test passed through the local backend and hosted Privy signer: Mercator discovery → fal FLUX Schnell POST → owner approval → sponsored 0.003 USDC.e payment, zero agent gas, confirmed transaction and HTTP 200. Transaction: `0x6415e9650e91e80f5f787fea7702db10d618090ff789490a685912308759667d`. The response was 386-byte JSON containing an image URL; the caller separately downloaded/viewed the 512×512 JPEG (299,833 bytes). This verifies that flow, not all tokens/providers, large responses or async completion. Further mainnet spending requires fresh owner authorization.

## Official references

- [OUSD and supported legacy currencies](https://tempo.xyz/developers/docs/guide/ousd)
- [Mainnet token registry](https://tokenlist.tempo.xyz/list/4217) / [Testnet registry](https://tokenlist.tempo.xyz/list/42431)
- [Fee specification](https://tempo.xyz/developers/docs/protocol/fees/spec-fee)
- [Tempo oracle providers](https://tempo.xyz/developers/docs/ecosystem/data-analytics)
- [RedStone Tempo feeds](https://app.redstone.finance/push-feeds?networks=tempo&testnets=true)
- [RedStone SDK verification documentation](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/README.md)

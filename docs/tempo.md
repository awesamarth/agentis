# Tempo payments

## Scope and verification

Agentis supports **transfers and one-shot MPP `charge` payments in pull or push mode, including same-token splits; pull supports agent-paid or provider-sponsored gas, while push is agent-paid** on Tempo mainnet (4217) and Moderato testnet (42431). Hosted dashboard, SDK, CLI and MCP use the same backend policy/approval pipeline; local CLI custody remains separate.

**Full Tempo compatibility remains a goal, not a completed claim.** Remaining MPP gaps include sessions, subscriptions and zero-amount proofs. They require their own authorization/accounting lifecycles; current unsupported offers fail explicitly rather than being silently substituted. Bridges, automatic swaps and arbitrary TIP-20 tokens are not included. Existing ENS/Uniswap deployments are unchanged.

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

## Split charges

A provider may specify up to ten additional recipients in its challenge. The charge's `amountAtomic` remains the **total**: the primary recipient receives total minus the split amounts, which must leave a positive remainder. All recipients use the selected token; cross-token splits are not supported.

The selected distribution is persisted as ordered `mpp.splits: [{ to, amountAtomic }]`, alongside the unchanged challenge. Shared `paymentTransfers` derives every actual transfer; approval/CLI output shows each recipient and share, and recipient allowlists apply to all of them. Budget reservation and settlement count the total once, plus agent-paid fees. Every call, optional split memo and transfer event is checked; duplicate recipients require distinct transfer evidence. A changed distribution requires a new approval.

These are provider-defined MPP splits, not a general bulk-send API. Base x402 behavior is unchanged; no Base split support is implied.

## Push charges

Push-only offers select `mpp.mode: 'push'`, persisted and bound to owner approval. Offers allowing both modes (or omitting `supportedModes`) retain the pull preference. Historical operations without `mode` remain pull; there is no runtime mode substitution. Push requires a positive agent-paid fee ceiling and cannot use provider sponsorship. No new fetch endpoint or mode flag is needed.

Hosted and local execution share push preparation/submission helpers in `packages/core/src/tempo.ts`. Unlike the SDK's sign-and-send convenience method, preparation only constructs and signs through the existing exact custody guard. It uses the pinned `mppx@0.9.3` challenge/realm-bound attribution memo, or the approved explicit memo, and preserves all split transfers. Signed bytes/hash and the hash credential are persisted **before** RPC submission. Only that saved transaction is broadcast, with transport retries disabled. Agentis verifies successful on-chain settlement before making the original HTTP request with `{ type: 'hash', hash }` credentials.

Reverted payments never reach the provider; settlement charges only their actual fees. Unknown submissions retain reservations and reconcile by the saved hash, without re-signing or rebroadcasting. A confirmation timeout can leave the provider uncontacted even if the payment later settles. Provider errors/body failures can likewise occur after a successful payment; same-key retries check/return the existing operation and do not automatically retry the paid HTTP request. Automatic result recovery is not implemented. HTTP results are retained even when another worker reconciles before the response completes.

## Provider-sponsored gas

A challenge advertising `feePayer: true` creates an operation with `mpp.sponsored: true` and `maxFeeAtomic: "0"`. Only the API charge is reserved against the agent. No agent gas-token balance or fee-token USD valuation is required. RPC gas estimation still constructs the sponsored transaction. The sponsor—not the agent—selects and pays for its fee token.

The sender signs the Tempo sponsorship payload, binding every exact transfer, chain, nonce and validity window. The installed Privy transaction formatter drops the sponsorship marker, so hosted signing uses Privy's `signSecp256k1` only for that constructed and validated payload. The MPP client never receives an unrestricted raw-hash signer.

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

For `client.fetch`, optional `asset` and `feeAsset` accept exact supported token symbols or IDs. MPP discovery chooses an eligible offer in catalog preference order (OUSD first), or only the explicitly requested token. It does not probe balances to choose another currency. Only the selected challenge is persisted, with its total amount, primary recipient, ordered splits, chain, expiry and optional memos. Descriptive metadata carries no execution authority; unknown financial extensions fail closed.

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
- `bun testing/tempo-splits-live-check.ts --testnet` — opt-in public Moderato integration using a new disposable local wallet and faucet tokens, with an official SDK loopback seller. Sponsored/self-paid three-way splits, repeated recipients, a split memo, recipient balance deltas, HTTP 200 delivery and same-key no-resend passed. Sponsor fees use the SDK-allowed pathUSD; payment is testnet alphaUSD. This is not hosted Privy verification and is not part of the offline suite. A live check also exposed RPC `feePayerSignature: null` versus unsigned-envelope sponsorship semantics; settlement now normalizes RPC absence and recovered the original confirmed payment without resending.
- `bun testing/tempo-splits-live-check.ts --testnet --push` — two actual public-testnet push charges passed using a faucet-funded isolated local wallet and the official SDK seller. Verified challenge-bound hash credentials, three-way splits including repeated recipients and a split memo, exact POST body delivery, recipient balance deltas, HTTP 200 and post-payment HTTP 503, fee settlement and same-key no-resend. These local-key checks are separate from the real hosted Privy mainnet evidence below. Offline checks also cover lost RPC responses, reverted transactions and lost HTTP responses. The isolated database check covers concurrent settlement before HTTP response persistence.
- From `apps/backend`: `bun ../../testing/tempo-readonly-check.ts` — explicit live RPC/token/oracle checks and unpaid seller discovery. Does not sign or submit.

Read-only checks and fake-executor tests are not proof of live custody/signing/settlement. A separately owner-authorized mainnet test passed through the local backend and hosted Privy signer: Mercator discovery → fal FLUX Schnell POST → owner approval → sponsored 0.003 USDC.e payment, zero agent gas, confirmed transaction and HTTP 200. Transaction: `0x6415e9650e91e80f5f787fea7702db10d618090ff789490a685912308759667d`. The response was 386-byte JSON containing an image URL; the caller separately downloaded/viewed the 512×512 JPEG (299,833 bytes). This verifies that flow, not all tokens/providers, large responses or async completion. Current mainnet test authorization is scoped to `testing-another-agent` in `AGENTS.md`.

## Hosted Privy split/push mainnet evidence

With the owner's `testing-another-agent` set to automatic within its existing limits, the local backend + real Privy signer + controlled official-SDK seller confirmed three USDC.e split charges:

- Pull + splits: operation `fd30cdbe-af0d-4d23-ba90-e01405684bd1`, transaction `0xe77a514ea545fae18c02f642257a707d8ca8832598b86373f5667438ab17c5bc`; 0.001 USDC.e plus 0.000045 USDC.e fees.
- Push + splits: operation `0e3b0bc3-3890-481e-9859-11ac69985e7e`, transaction `0xe8621b7821b9bfacc410aac0bd759b0d7cf58e057a898b1a69dbc3bee17b8650`; 0.001 USDC.e plus 0.000041 USDC.e fees.

- Sponsored pull + splits: operation `eaedfcf6-2d33-469b-a837-9bb206cdde62`, transaction `0x38267e77d6c09e4a7149595e230c759c6fc0b932c5755b55a879872a487d3b4d`; 0.001 USDC.e, zero agent fees. The fixture merchant signs only its sponsor authorization, never the Agentis payer proof.

All returned HTTP 200 with the exact POST body preserved. Independent receipt reads confirmed the hosted payer and ordered transfers of 750/100/150 atomic units, including the repeated affiliate. Same-key retries returned the same operation/hash/body without any new seller request or payment. Other payment/fee token combinations and providers are not established by these checks; this is real hosted custody using a local backend, not production deployment.

The first attempts were denied before signing because a one-micro-dollar quote increase exceeded the exact reservation. New hosted requests now reserve 1% price headroom in the reviewed/hash-bound USD ceiling, still subject to budgets and fresh execution pricing; existing approvals and token/fee caps are not enlarged. Settlement charges actual amount/fees only.

## Official references

- [OUSD and supported legacy currencies](https://tempo.xyz/developers/docs/guide/ousd)
- [Mainnet token registry](https://tokenlist.tempo.xyz/list/4217) / [Testnet registry](https://tokenlist.tempo.xyz/list/42431)
- [Fee specification](https://tempo.xyz/developers/docs/protocol/fees/spec-fee)
- [Tempo oracle providers](https://tempo.xyz/developers/docs/ecosystem/data-analytics)
- [RedStone Tempo feeds](https://app.redstone.finance/push-feeds?networks=tempo&testnets=true)
- [RedStone SDK verification documentation](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/sdk/README.md)

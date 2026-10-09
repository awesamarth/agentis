# Solana MPP

Agentis supports one-shot Solana MPP `charge` requests on catalog Solana mainnet and Devnet, using `@solana/mpp@0.5.2`. The upstream protocol/SDK is still evolving; support here refers to this pinned implementation.

## Supported contract

- Native SOL and the selected network's catalog USDC mint. USDC is the paid-fetch default; select `asset: 'SOL'` explicitly for native payments.
- Pull-mode transaction credentials: Agentis signs, persists proof, then sends the credential to the provider for submission.
- Provider-sponsored or agent-paid fees. Sponsorship covers transaction fees and recipient associated-token-account (ATA) creation; the agent reserves zero SOL fees.
- Self-paid fees are capped in **lamports** and include worst-case ATA rent for each distinct recipient, even if its ATA currently exists. Repeated recipients do not multiply rent. Settlement records actual fee/rent expenditure.
- Exact provider HTTP method, headers and body; normal shared policy, budget, owner approval and idempotency controls.
- Hosted backend, SDK, CLI and MCP; local CLI custody uses the same transaction guard and reconciliation code.

Existing Solana x402 remains available. Discovery prefers x402 USDC when both headers are offered; an MPP-only offer or explicit native SOL selection uses MPP. No arbitrary mint, Token-2022, session or subscription authorization is accepted. Solana push credentials are not implemented in this change. Unsupported financial extensions fail closed, rather than being dropped.

## Split charges

Provider-defined splits support up to eight additional recipients in the same SOL/USDC asset. The charge amount is the **total**, not an additional payment to the primary recipient. Ordered `mpp.splits: [{ to, amountAtomic }]` is bound to approval and must leave a positive primary remainder. Shared transfer/policy helpers ensure every recipient is allowed and the total is budgeted once. Approval and CLI output show the complete distribution.

The guard reconstructs every transfer and ATA instruction, includes approved split memos, sizes the compute limit for the transfer count and enforces Solana's serialized transaction-size limit. Actual supported recipient count may therefore be lower than the protocol maximum. On-chain confirmation verifies the exact saved message/signature and aggregate recipient deltas (including repeated recipients), then settles actual fees/rent. Splits do not bypass custody, approval or fee ceilings.

## Usage

Hosted CLI uses atomic ceilings:

```sh
agentis fetch https://provider.example/paid \
  --wallet <solana-wallet-id> --asset SOL \
  --max-amount-atomic 1000000 --max-fee-atomic 3000000 \
  --key unique-purchase
```

That is a 0.001 SOL payment ceiling and a 0.003 SOL fee/rent ceiling. Use `--max-fee-atomic 0` to accept sponsored offers only. Omitting the hosted fee ceiling also restricts selection to sponsored offers. For USDC, payment units have six decimals; SOL payment/fee units have nine.

Local CLI adds `--local --chain solana-devnet`; `--max-amount` and `--max-fee` accept decimal units. Its default Solana fee ceiling is 0.005 SOL. MCP `agentis_fetch` also converts SOL payment/fee amounts with nine decimals and defaults to USDC unless SOL is selected. `feeAsset` remains Tempo-only; Solana fees are in SOL.

SDK/API clients use the existing `fetch` contract. No new endpoint, DB migration or wallet permission is needed.

## Signing and recovery

The client checks the full catalog genesis hash, exact mint/decimals, payer, every recipient/amount, fee payer, compute budget, instruction list and blockhash. It reconstructs the expected message before calling custody. No SDK sign-and-send capability is exposed.

A deterministic per-operation memo distinguishes separate purchases with otherwise identical transfers and blockhashes. The SDK receives only a guarded signing interface; Agentis adds that memo locally, verifies the resulting signature and persists the exact message before the paid HTTP request.

A sponsor adds the first transaction signature, so the final transaction identifier may be unknown at preparation. Agentis saves the provider receipt reference before consuming the body, then checks on-chain message bytes and the agent's saved signature. If the response is lost, it searches the payer's history from the saved slot. Unknown submissions retain reservations and never trigger a fresh payment automatically.

The provider's optional recent blockhash is an RPC-saving hint, not a charge term; it may expire during approval or preparation. After validating the SDK's exact instruction message, Agentis binds a fresh finalized blockhash before its single custody call, compatible with the installed seller SDK's default finalized send-preflight. The original challenge, payment/fee terms and approval deadline remain unchanged. Validity checks use the fresh RPC context slot, and saved/uncertain submissions are never re-signed or refreshed. The shared 10 MiB response bound and 20-second HTTP deadline are unchanged.

## Verification

- `bun test testing/solana-mpp.test.ts`: installed SDK, real ephemeral signatures, sponsored/self-paid SOL/USDC, purchase uniqueness, fee/rent ceilings, network/term rejection and sponsored lost-response reconciliation with fixture RPC data.
- `bun testing/solana-mpp-local-check.ts`: manual, separate from the offline suite. Requires a disposable Surfpool Devnet fork on `127.0.0.1:18899`. Creates an isolated local wallet and seller, funds them only on the local SVM, and verifies all four SOL/USDC × sponsored/self-paid flows, response delivery and same-key no-resend. Also exercises the hosted adapter through the installed Privy SDK with a fake Privy custody API.
- `bun testing/solana-mpp-local-check.ts --splits`: the same four flows plus hosted-adapter fixture with a three-transfer split and repeated recipient. Paid results and same-key no-resend passed. Self-paid USDC charged 4,083,561 lamports: two distinct recipient ATAs plus the transaction fee, not three ATA rents. Sponsored cases charged zero agent fees.
- The local seller uses localnet verification for Surfpool-tagged blockhashes while advertising the fork's Devnet identity. Client/catalog/genesis checks are unchanged. This is local SVM integration evidence, **not a public-network or real Privy authorization test**.

### Real hosted Privy mainnet evidence

After the owner funded `testing-another-agent` with 1 USDC and 0.01 SOL, the local backend → real Privy signer → mainnet → official SDK seller path passed these charges under the owner's automatic mode and existing limits:

| Charge | Operation | Amount | Agent fees/rent (SOL) | Transaction |
| --- | --- | --- | --- | --- |
| USDC splits, self-paid | `4c9cae05-e2c7-451d-b61e-1f26f54c4e1a` | 0.001 USDC | 0.002981881 | `5toy577jZEucbStBy4jVZvzHhsJrGxEuS3Ach2atPWZh4GK65fCpTQ3GVVzCnuQDK7qdqBj79wLzp9Ymij712TeS` |
| SOL single, self-paid | `3f615488-2cd9-43bf-84ca-320dc577d303` | 0.001 SOL | 0.000005001 | `3jkQZLDKWFnfmxLVou1UZ6tmecqf1GovDt35SpRxaBoY9HwrAvAFuttKyrrbgRtd91ZagDRQFJM8k1quDrp3wphq` |
| USDC splits, sponsored | `6c17dc6f-11e3-44fb-a98a-3270f43ff4f8` | 0.001 USDC | 0 | `PZrwWGBDfcvB9PhzaEpxMzB8WPQjPfRQNRrdF7vUbw3woGxpBwm351AMtsyqHHUAYQX4EDf7McdY8EsMdFEu4Dp` |
| SOL single, sponsored | `e727574f-9216-405b-b6eb-10fd4f252653` | 0.001 SOL | 0 | `5sgwf5frBMgS581rZVABeaHsxpYWoKvbEikMCuopbfGyMiniaTZ6xR4cEjGk7RQb2pyezgwrTrBwfQ676X1WBCr1` |

All returned HTTP 200 and preserved the exact POST body. Independent finalized public-RPC reads confirmed the hosted payer, split recipient deltas (750/100/150 atomic units, repeated affiliate), native debits and zero sponsored agent fees. Same-key retries returned identical operations/hashes/results without any additional seller request/payment. Total agent spending: **0.002 USDC + 0.004986882 SOL**, including fees/rent. The merchant's receiver key signs only as sponsor, never as Agentis payer. Sponsored USDC reused the ATAs created by the self-paid case: this does **not** establish sponsored creation/rent for new ATAs, native SOL splits, every provider or failure scenario, or production deployment.

Earlier attempts exposed discovery-time blockhash expiry and insufficient funds before custody signing. After funding, operation `a4b63a5c-eade-461d-891f-d5b2abe564e6` signed but got a seller HTTP 500; Agentis retained the reservation and did not resend. The installed seller SDK simulates at confirmed commitment but sends with default finalized preflight. A freshly confirmed blockhash can fail that preflight, so preparation now uses a fresh finalized blockhash. Before a new purchase, the exact original blockhash was located in a finalized block; two independent mainnet RPCs showed it invalid, more than 1,500 finalized blocks old, with no signature/transaction history. Only that operation was manually marked expired/no-charge after its approval deadline, under an owner lock and exact proof checks. This was narrow operator recovery, **not implemented automatic reservation expiry**. Automatic recovery tooling remains pending. Mainnet authority is scoped in `AGENTS.md`; local/fake checks do not independently authorize spending.

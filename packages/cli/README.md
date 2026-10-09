# Agentis CLI

Requires [Bun](https://bun.sh) on your PATH (the CLI executable uses Bun).

Install: `bun add -g @agentis-hq/cli@0.5.0` (or `npm install -g @agentis-hq/cli@0.5.0`). Then run `agentis login` and `agentis --help`.

For repository development, run `bun run build:packages`, then `bun packages/cli/src/index.ts --help`. Source commands in the examples below also work as `agentis ...` after installation.

Output is human-readable by default; use `--json` for machine-readable results. `whoami` shows only agent names and named chains with their IDs, not backend URLs or grant IDs. Normal login progress goes to stdout; with `login --json`, progress goes to stderr so stdout contains only the final JSON. Large/binary paid-response bodies remain available in full through `--json`.

Set `AGENTIS_API_URL` if needed (defaults to `https://api.agentis.systems`; use `http://localhost:3001` only for a separate development backend), then run `agentis login`. Alternatively set `AGENTIS_TOKEN` privately; it overrides stored login. Use scoped executor grants for agents, not owner credentials.

## Browser login

- `login [--no-browser]`: opens the owner consent page (or prints its link). Match the terminal code, select multiple agents and their enabled network wallets, then connect. The page reuses the dashboard’s create-agent modal. Nothing is preselected.
- `whoami`: shows linked agents and network scopes, never keys.
- `logout`: removes local credentials only. Revoke server keys in each agent’s dashboard API access panel when access is no longer wanted.

The CLI receives one executor key per selected agent, restricted to the selected networks—not an owner JWT or account-wide key. New networks are not automatically included. Budgets, paused/ask/automatic mode and owner-only administration remain unchanged. Keys have no expiry by default and remain valid until revoked.

`wallet list` and `operations list` combine the linked credentials. Payment wallet IDs select the matching credential automatically; `--agent <id-or-unique-name>` narrows commands to one linked agent. Operation lookup uses the credential that can access that operation. Operation-control access does not transfer between keys; read-only history separately includes earlier payments within the authorized wallets/networks.

Credentials live in `~/.agentis/cli-session.json` (directory 0700/file 0600, filesystem protection—not encrypted custody), bound to the API URL. Unset `AGENTIS_TOKEN` before logging in. Existing sessions are not silently overwritten; log out before choosing a replacement selection, and revoke old keys separately. Local wallet files are untouched.

Login requests expire after ten minutes. A random CLI-only secret binds the one-time exchange; keys and secrets never appear in the browser URL, and the backend stores only hashes of credentials/secrets. If the exchange response is lost after issuance, restart login and revoke the unclaimed CLI keys shown in the dashboard. No automatic owner-authentication fallback.

## Commands

- `wallet list [--local]`
- `wallet create --local [--name <name>] [--chains base,arc,tempo,solana]`
- `wallet send --local --wallet <name-or-id> --chain <chain> --to <address> --amount <decimal> --key <request-key> [--asset <symbol>] [--max-fee <decimal>] [--yes]`
- `fetch <url> --wallet <wallet-id> --max-amount-atomic <cap> --key <stable-idempotency-key>`
- `operations create --file <request.json> --key <stable-idempotency-key>`
- `operations list|get <id>|wait <id>`
- `operations approve|reject <id> --hash <operation-hash>` (owner only)
- `capabilities`

## Local multichain wallets

```sh
# Interactive: name, ↑/↓ + Space to select chains, then USD limits.
# Base is preselected. No plugins step yet.
bun packages/cli/src/index.ts wallet create --local

# Non-interactive; omitted --chains defaults to Base.
bun packages/cli/src/index.ts wallet create --local --name personal --chains base,arc,tempo,solana --json
bun packages/cli/src/index.ts wallet list --local

# Amount and fee budget are decimal token units, not atomic units.
bun packages/cli/src/index.ts wallet send --local --wallet personal --chain base \
  --to <recipient> --amount 0.001 --asset ETH --key my-transfer-001
# Add --yes for automation and --json for machine-readable results.
```

One name/mnemonic derives a shared EVM address for enabled Base/Arc/Tempo networks (`m/44'/60'/0'/0/0`, Viem) and a separate Solana address (`m/44'/501'/0'/0'`, existing micro-ed25519-hdkey + web3.js). Creation is offline; no Privy or hosted API calls. The exact cyan Agentis banner appears on help/interactive creation, never in JSON results.

Version-4 wallet files live in `~/.agentis/wallets-v2` (0700 directory / 0600 files). Older files are rejected without modifying them or reinterpreting testnet aliases as mainnet consent. No automatic migration. Mnemonics are never printed. **Files are not encrypted; anyone with file access can sign or bypass CLI restrictions.** There is no local agent-vs-owner permission boundary. Local policies are CLI safeguards, not hosted authorization.

Supported local sends derive from the shared network catalog: Base/Ethereum ETH and USDC, Arc testnet native USDC, Solana SOL/USDC, and Tempo OUSD/USDC.e/pathUSD plus testnet alphaUSD. BetaUSD/thetaUSD are not supported. Mainnet is the default; testnets require explicit aliases. RPC URLs use the selected network's configured environment override or public default; actual EVM chain IDs / Solana genesis are checked before signing. Solana token sends can create the recipient ATA. Funds are sent directly with the local key, not via the backend. Local x402/MPP is available through `fetch --local` (below).

Default fee budgets: Base and Ethereum Sepolia 0.0001 ETH, Arc 0.01 USDC, Tempo 0.01 in the selected fee token, Solana 0.005 SOL; override with `--max-fee`. Base checks estimated execution fees plus a buffer for L1 fees (not a fixed on-chain cap on changing L1 fees). Solana budgets possible ATA rent as well as fees. Tempo uses protocol nonce lane 0 with an explicitly fetched pending nonce; 2D lanes are not allocated. Tempo gas accounting uses 18-decimal protocol USD units, rounded to six-decimal fee-token precision. `--fee-asset` selects a Tempo gas token independently; defaults to the payment token when eligible, or OUSD for testnet USDC.e.

Local sends persist signed proof/hash in owner-only `wallets-v2/transactions` journals before submitting. **Reuse identical arguments and the same `--key` to check an uncertain send.** Existing keys only return/check the original transaction, never sign/resend. Preparation failures have no submitted transaction; inspect the journal before using a new key. Per-wallet/network locks prevent concurrent CLI nonce selection; a crash may leave a lock needing manual inspection/removal. Other software using the same private key is not coordinated. Settled journals discard signed bytes. No automatic expired-proof recovery was added.

`testing/local-wallet-check.ts` covers no-money derivation/storage/CLI/network guards. `testing/local-wallet-live.ts --execute` is an explicit small testnet funding/send check, not a routine suite; ignored funding journals prevent blind funding retries. All six supported sends and same-key retries were live-confirmed; one original Base USDC preparation failure was not diagnosed, while a later attempt succeeded.

Hosted transfers and paid HTTP requests use the common backend on supported mainnets and explicit testnets. Seller/facilitator support must match the selected network. Tempo MPP supports one-shot pull charges with agent-paid or provider-sponsored gas, and agent-paid push charges, in its allowlisted currencies. Uniswap and ENS remain pinned to their existing testnets; core mainnet support does not imply mainnet plugin support.

`wallet list` shows both hosted and local wallets; `--local` or `--hosted` filters to one type (mutually exclusive). Hosted entries include only enabled wallets. Without a login, the default lists local wallets and prints a hosted-login notice to stderr; `--hosted` requires authentication. API/auth errors are not silently hidden. `--json` returns `[{name, custody, agentId?, wallets: [{walletId, chainId, address}]}]`, without internal policy/setup fields. Local network entries share their named wallet's ID. Human output starts with a blank line and uses bold cyan names, explicit Local/Hosted labels, bold chain headings and two blank lines after each wallet/agent block.

## Discover APIs (no wallet or login)

```sh
agentis discover "web search" --limit 3
agentis discover describe exa
agentis discover describe exa --json
```

Mercator-backed public catalog reads only. Search shows provider endpoints, estimated prices and advisory Agentis compatibility; describe includes input fields/examples and payment offers. `--json` includes full schemas. Queries go through Agentis to Mercator; no keys, local wallet files or session files are read. No provider calls or automatic payments occur. Use existing `fetch` separately with an explicit wallet and spending ceiling. See [discovery semantics and local deployment status](../../docs/discovery.md).

## Paid request methods and bodies

Both hosted and local `fetch` support `--method/-X` (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS), repeatable `--header/-H`, and either `--data/-d` (UTF-8) or `--data-file` (exact bytes, including binary/multipart). Set the provider's Content-Type. Data defaults to POST; otherwise GET. No JSON-only restriction or 24 KiB outbound cap. Request fields are bound to approval/idempotency; changing them with the same key is rejected. Deployment request limits and existing response/transport protections still apply.

```sh
agentis fetch https://api.exa.ai/search --wallet <tempo-wallet-id> \
  -X POST -H 'Content-Type: application/json' \
  -d '{"query":"Tempo documentation","type":"instant","numResults":1}' \
  --asset USDC.e --max-amount-atomic 10000 --max-fee-atomic 0 --key <unique-key>
```

This creates a payment request through normal policy/approval. A zero gas ceiling selects sponsored Tempo offers; it never authorizes an unsponsored fallback. Do not run against mainnet without spending authorization.

## Balances

```sh
bun packages/cli/src/index.ts wallet balance
bun packages/cli/src/index.ts wallet balance --local --wallet local-multichain-check
bun packages/cli/src/index.ts wallet balance --hosted --agent research-agent
```

Default includes both custody types; `--local`/`--hosted` filters them, like wallet list. Shows per-chain token amounts and an estimated USD total; `--json` retains exact atomic amounts/USD micros. Local balances use existing Viem/Solana clients with network checks (Base uses Multicall3). Hosted balances reuse the backend reader, restricted to the current grant's enabled wallets/networks. Reads never sign or change budgets. Missing RPC data/prices remain unavailable or explicitly incomplete, not zero.

## Hosted sends

```sh
bun packages/cli/src/index.ts wallet send --hosted --wallet research-agent --chain base --asset USDC --amount 0.001 --to <address> --key <unique-request-key>
```

Hosted is the default unless `--local` is supplied. Use an agent name/ID or wallet ID plus a chain; ambiguous or inaccessible selections fail. Amounts and optional `--max-fee` are decimal token units, using the same supported assets/default fee budgets as local sends. Ask mode returns **Approval required** and the dashboard approval URL; no owner token copying is needed. Automatic mode uses the existing backend execution queue and waits for the result. `--yes` cannot bypass hosted approval or policy. Reuse identical terms/key after uncertainty; do not submit under a new key. `operationId` identifies the payment request, not the wallet.

## Hosted policy and history

```sh
bun packages/cli/src/index.ts policy show --hosted --agent research-agent
bun packages/cli/src/index.ts wallet history --hosted --agent research-agent --limit 20
```

`--hosted` is optional on these commands; `--local` keeps the existing local behavior. Omit `--agent` to include all linked credentials, or narrow by `--wallet <wallet-id>`. Hosted `policy set` is unavailable: use the dashboard. Policy reads require an accessible enabled wallet and show its agent's mode, USD limits, aggregate spent/reserved amounts and recipient restrictions. Aggregate amounts include all of that agent's networks and credentials, not just the current key's operations.

History is read-only and oldest → newest within the latest selected records (maximum 100 per authorized scope). Executor keys see payments made by any key within their currently authorized enabled wallets/networks; owners see their own account's history. The issuing key does not filter history, so re-login does not hide previous payments. Operation lookup, approval and execution permissions are unchanged. JSON remains opt-in.

## Local policies, history and paid HTTP

```sh
bun packages/cli/src/index.ts policy show --local --wallet personal
bun packages/cli/src/index.ts policy set --local --wallet personal
# No flags opens interactive editing; flags work unattended:
bun packages/cli/src/index.ts policy set --local --wallet personal --per-transaction 5 --hourly 20 --daily 50 --total 100
bun packages/cli/src/index.ts policy set --local --wallet personal --pause
bun packages/cli/src/index.ts policy set --local --wallet personal --resume --daily none
bun packages/cli/src/index.ts wallet history --local --wallet personal --limit 20
bun packages/cli/src/index.ts fetch 'https://seller.example/paid' --local --wallet personal --chain base --max-amount 0.01 --key api-request-001
```

Creation prompts for optional USD caps after chains; the same `--per-transaction`, `--hourly`, `--daily`, `--total` flags work on creation. Blank/`none` means no cap; zero blocks. Limits combine every network of a named wallet, include fees, use rolling hourly/daily windows and a non-resetting total. ETH/SOL/USDC prices retain DefiLlama freshness/confidence checks. Tempo uses shared verified RedStone prices for pathUSD/canonical USDC and direct CoinGecko Open USD prices for OUSD; Tempo test tokens have a separate explicit test-USD valuation. Accounting is bigint USD micros. Missing/stale quotes block new signatures.

Both local sends and paid fetch reserve amount + maximum fees, then recheck current rules and prices immediately before signing. Wallet-wide policy locks coordinate concurrent requests across networks. Confirmed spend uses execution quotes and actual fees; failed transactions charge fees only. Unknown signatures/submissions retain reservations, even outside rolling windows. **`--yes` skips only terminal confirmation, not policy.** No separate approval command, password or biometric flow.

Policies stay in the wallet file; the owner-only `wallets-v2/policies` ledger persists spend/reservations. Existing wallets default to active/uncapped. Tracking starts with this feature: older transactions remain visible in history but are not retroactively USD-priced. History is a compact readable list, most recent entries displayed oldest → newest; older undated journals say “Older entry”. It shows cached status; reuse the original request/key to reconcile unsettled work. JSON remains opt-in.

Local paid HTTP uses separate official x402 and MPP adapters: Base/Arc USDC EIP-3009, Solana sponsored x402 USDC partial signing, Solana MPP SOL/USDC charges with sponsored or agent-paid fees, and Tempo MPP pull/push credentials in OUSD, USDC.e or pathUSD (also alphaUSD on testnet). `--max-amount` uses the selected payment asset's decimals (9 for Solana SOL, 6 for USDC/Tempo tokens); `--max-amount-atomic` is also accepted. Tempo `--max-fee` defaults to 0.01 of the selected gas token; `--asset` selects a seller currency and `--fee-asset` selects an eligible fee token; `--max-fee-atomic` uses 18-decimal protocol USD. Tempo MPP uses its expiring nonce lane, distinct from direct sends' protocol lane 0.

Local credentials/proofs are saved before submission; x402 settlement hashes are saved when headers arrive and checked against exact on-chain payment terms. Missing hashes use nonce/token-account history recovery; no automatic payment resend or expired-proof release. HTTP success and chain settlement are separate. Binary responses are retained; small text/JSON bodies render readably. The shared transport pins public DNS, forbids redirects/embedded credentials and bounds time/body size. Explicit test fixture access requires `AGENTIS_PAID_FETCH_LOCAL_ORIGINS=http://127.0.0.1:3010`; production private-URL exceptions remain disabled.

Earlier testnet checks of the four local paid rails returned HTTP 200 with confirmed settlement; this does not establish live verification of the new Tempo token matrix or mainnets. `testing/local-policy-check.ts` exercises fee-inclusive caps, concurrency, pause/`--yes`, signing-time rechecks, failure fees, unknown retention and rolling/total semantics without money. HTTP-failure-after-payment and interruption recovery were not live-tested locally. Plugins remain deferred.

## Hosted x402 paid HTTP

Use `agentis login`, or create an API key on the agent’s dashboard page and set `AGENTIS_TOKEN` privately (never as a CLI argument). Select that agent’s Base wallet from `wallet list`.

```sh
bun packages/cli/src/index.ts fetch 'http://127.0.0.1:3010/api/aqi?city=delhi&rail=base' \
  --wallet 4a6c604f-303f-459c-ae79-fcaa04a67341 --max-amount-atomic 10000 --key research-aqi-001
```

`10000` means a maximum of 0.01 USDC. Backend and worker require `AGENTIS_PAID_FETCH_LOCAL_ORIGINS=http://127.0.0.1:3010` for this local fixture. Otherwise URLs must use public HTTPS; private/mixed DNS, redirects and caller-supplied payment proofs are not allowed. Local exceptions are disabled in production.

- `ask`: returns an approval URL. Approve in the authenticated dashboard, then `operations wait <id>` or `operations get <id>`.
- `automatic`: waits for the operation. Same per-agent rules and atomic USD reservations apply; CLI has no wallet signing keys.
- Reuse the **same key** after any timeout. No automatic second payment. A submitted authorization stays reserved until its exact on-chain nonce settles or the finalized chain proves it expired unused.
- The operation detail returns `httpResponse.status`, `headers` and `bodyBase64`; decode the latter for JSON or binary data. Lists omit response bodies. Payment settlement is independent of HTTP success; a lost response does not erase a settled charge.
- All x402 rails persist the settlement response’s transaction ID as soon as HTTP headers arrive, then verify the approved payment directly on-chain by that ID. Missing-response recovery uses EVM authorization logs or paginated Solana history. Receipt lookup retries never resend payment.
- Base and Arc use EIP-3009 with facilitator-paid gas. Select the corresponding agent wallet and `rail=base` or `rail=arc`. The price ceiling is in 6-decimal USDC units on both. Arc’s operation uses its existing native USDC ledger (18 decimals), with an exact bigint conversion; balances are not counted twice.
- Solana devnet uses `rail=solana` and the agent’s Solana wallet. The facilitator pays gas; the wallet needs USDC in its associated token account. Privy’s native Solana Kit adapter only partially signs a checked transfer: fixed mint/recipient/amount, no lookup tables or extra programs, and an external fee payer. Settlement matches the exact signed message and token balance deltas, not the seller’s HTTP claim. Unresolved submissions remain reserved without resending; automatic unused-expiry release remains follow-up work.

## Solana MPP paid HTTP

Solana mainnet/Devnet paid fetch supports MPP pull-mode charges as well as existing x402. Select `--asset SOL` for native payments; USDC is the default. Hosted unsponsored MPP requires `--max-fee-atomic` in lamports; local `--max-fee` defaults to 0.005 SOL and includes potential recipient ATA rent. Sponsored charges cost the agent zero gas/rent. Same-asset splits are supported, with every recipient/share shown and possible ATA rent budgeted per distinct recipient. Sessions and push-mode credentials are not implemented. See [Solana MPP](../../docs/solana-mpp.md) for the exact contract and local verification.

## Tempo MPP paid HTTP

Use the same `fetch` command with the agent’s Tempo wallet and `--max-fee-atomic`. For the local fixture, use `rail=tempo`, `--max-amount-atomic 10000` (0.01 alphaUSD) and `--max-fee-atomic 10000000000000000` (at most 0.01 alphaUSD gas, expressed in 18-decimal protocol USD units). Both amount and maximum fees are reserved under the same agent budget.

Dual-mode offers retain pull; push-only offers select agent-paid push, with delivery mode bound to approval and shown in CLI output. Pull credentials use the MPP SDK through an exact-transaction signing guard. Push preparation uses public viem actions through that same guard, persists signed bytes/hash before broadcast, then verifies settlement before sending hash credentials to the provider. Reverted transactions never reach the provider. RPC/HTTP failures never authorize another payment or an automatic paid-request retry. Hosted sponsorship signs only the validated Tempo payload through Privy because the installed transaction formatter drops the sponsor marker. Only the approved primary transfer and ordered splits in the selected allowlisted Tempo token are permitted, with exact recipients, amounts and memos: no swaps, unlisted tokens or other chains. The charge amount is the total across all recipients, not an amount added to the splits. Multiple seller offers are filtered by exact token, chain, price and expiry; the chosen offer and fee token are persisted before approval. See [Tempo support and pricing](../../docs/tempo.md). Sponsored charges bind zero agent gas before approval. The provider chooses/pays its own gas token; its final transaction is verified against the saved sender proof. Lost-response recovery uses memo logs and never resends. The signed transaction is checked against its sender, every call, gas cap (if agent-paid) and expiry, then persisted before the seller receives it. Approval expires with the challenge. Chain settlement and actual fees are recorded even if the HTTP request fails; an unresolved submission remains reserved and is never blindly resent. Automatic release of unused Tempo submissions is not implemented.

Manual preflight: `testing/privy-x402-preflight.ts` checks challenge/price/recipient/network/fee boundaries, private-URL rejection, and server-quorum signing using a permanently expired zero-value authorization. `--fund` explicitly tops up the selected wallet to 0.05 testnet USDC. A saved funding attempt is never blindly resent. This preflight is not an authenticated paid-fetch end-to-end test.

# Agentis CLI (rewrite)

Run from the repo after `bun run build:packages`: `bun packages/cli/src/index.ts --help`.

Output is human-readable by default; use `--json` for machine-readable results. `whoami` shows only agent names and named chains with their IDs, not backend URLs or grant IDs. Normal login progress goes to stdout; with `login --json`, progress goes to stderr so stdout contains only the final JSON. Large/binary paid-response bodies remain available in full through `--json`.

Set `AGENTIS_API_URL` if needed (defaults to loopback port 3001), then run `agentis login`. Alternatively set `AGENTIS_TOKEN` privately; it overrides stored login. Use scoped executor grants for agents, not owner credentials.

## Browser login

- `login [--no-browser]`: opens the owner consent page (or prints its link). Match the terminal code, select multiple agents and their enabled network wallets, then connect. The page reuses the dashboard’s create-agent modal. Nothing is preselected.
- `whoami`: shows linked agents and network scopes, never keys.
- `logout`: removes local credentials only. Revoke server keys in each agent’s dashboard API access panel when access is no longer wanted.

The CLI receives one executor key per selected agent, restricted to the selected networks—not an owner JWT or account-wide key. New networks are not automatically included. Budgets, paused/ask/automatic mode and owner-only administration remain unchanged. Keys have no expiry by default and remain valid until revoked.

`wallet list` and `operations list` combine the linked credentials. Payment wallet IDs select the matching credential automatically; `--agent <id-or-unique-name>` narrows commands to one linked agent. Operation lookup uses the credential that can access that operation. A new login does not inherit operations created with older keys.

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
# Interactive: name, then ↑/↓ + Space to select chains, Enter to continue.
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

Version-3 wallet files remain in `~/.agentis/wallets-v2` (0700 directory / 0600 files). Existing version-2 Solana files are read in place without rewriting their mnemonic/address or enabling new networks. No automatic migration of older encrypted formats. Mnemonics are never printed. **Files are not encrypted; anyone with file access can sign or bypass CLI restrictions.** There is no local agent-vs-owner permission boundary or hosted approval/budget enforcement.

Supported local sends (testnet only): Base ETH/USDC, Arc native USDC, Tempo alphaUSD, Solana SOL/USDC. RPC URLs use `BASE_SEPOLIA_RPC_URL`, `ARC_TESTNET_RPC_URL`, `TEMPO_TESTNET_RPC_URL`, `SOLANA_DEVNET_RPC_URL` or public defaults; actual EVM chain IDs / Solana genesis are checked before signing. Solana token sends can create the recipient ATA. Funds are sent directly with the local key, not via the backend. Local x402/MPP remains unimplemented; `fetch --local` fails explicitly.

Default fee budgets: Base 0.0001 ETH, Arc 0.01 USDC, Tempo 0.01 alphaUSD, Solana 0.005 SOL; override with `--max-fee`. Base checks estimated execution fees plus a buffer for L1 fees (not a fixed on-chain cap on changing L1 fees). Solana budgets possible ATA rent as well as fees. Tempo uses protocol nonce lane 0 with an explicitly fetched pending nonce; 2D lanes are not allocated. Tempo gas accounting uses 18-decimal protocol USD units, rounded to alphaUSD precision.

Local sends persist signed proof/hash in owner-only `wallets-v2/transactions` journals before submitting. **Reuse identical arguments and the same `--key` to check an uncertain send.** Existing keys only return/check the original transaction, never sign/resend. Preparation failures have no submitted transaction; inspect the journal before using a new key. Per-wallet/network locks prevent concurrent CLI nonce selection; a crash may leave a lock needing manual inspection/removal. Other software using the same private key is not coordinated. Settled journals discard signed bytes. No automatic expired-proof recovery was added.

`testing/local-wallet-check.ts` covers no-money derivation/storage/CLI/network guards. `testing/local-wallet-live.ts --execute` is an explicit small testnet funding/send check, not a routine suite; ignored funding journals prevent blind funding retries. All six supported sends and same-key retries were live-confirmed; one original Base USDC preparation failure was not diagnosed, while a later attempt succeeded.

Hosted testnet transfers, Base/Arc/Solana testnet USDC x402 and Tempo alphaUSD MPP paid GETs use the common backend. Mainnet, other x402 networks and plugins remain unavailable. Published npm CLI is still the old prototype; use this checkout.

## x402 paid GET

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

## Tempo MPP paid GET

Use the same `fetch` command with the agent’s Tempo wallet and `--max-fee-atomic`. For the local fixture, use `rail=tempo`, `--max-amount-atomic 10000` (0.01 alphaUSD) and `--max-fee-atomic 10000000000000000` (at most 0.01 alphaUSD gas, expressed in 18-decimal protocol USD units). Both amount and maximum fees are reserved under the same agent budget.

The MPP SDK creates a pull-mode credential using Privy’s native Viem adapter. Only a single approved alphaUSD transfer-with-memo is permitted: no swaps, splits, sponsorship, other assets or other chains. The signed transaction is checked against its sender, call, gas cap and expiry, then persisted before the seller receives it. Approval expires with the challenge. Chain settlement and actual fees are recorded even if the HTTP request fails; an unresolved submission remains reserved and is never blindly resent. Automatic release of unused Tempo submissions is not implemented.

Manual preflight: `testing/privy-x402-preflight.ts` checks challenge/price/recipient/network/fee boundaries, private-URL rejection, and server-quorum signing using a permanently expired zero-value authorization. `--fund` explicitly tops up the selected wallet to 0.05 testnet USDC. A saved funding attempt is never blindly resent. This preflight is not an authenticated paid-fetch end-to-end test.

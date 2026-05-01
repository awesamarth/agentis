# Agentis — Agent Handoff

## Product
Agentis is financial infrastructure for AI agents on Solana: wallets, payments, policy enforcement, privacy, swaps, and yield.

Positioning for the current demo: a hosted + local agent wallet platform where agents can hold funds, make MPP/x402 payments, obey spending policies, and optionally use Umbra privacy.

## Builder Context
- Solo dev, full time. Ethereum background; Solana still newer.
- Direct, low-fluff collaboration preferred. Hinglish is fine.
- Goal is a Colosseum/Frontier funding-quality demo, not a throwaway hackathon toy.
- Prefer `@solana/kit` for new Solana code. Use `@solana/web3.js` only when a library/API expects it.

## Repo Map
```txt
agentis/
  apps/
    backend/       Hono API on Bun, default port 3001
    next-app/      Next.js dashboard, default port 3000
  packages/
    core/          shared types + policy engine
    sdk/           AgentisClient
    cli/           agentis CLI
    mcp/           local stdio MCP server
  sdk-testing/
    x402-server/   local x402 test server, port 4000
    mpp-server/    local MPP test server, port 4001
    agent-app/     SDK test scripts
  umbra-test/      standalone Umbra flow test app
  quasar-proj/     Quasar on-chain policy program
```

Local packages point to `src/` directly; no package build step is normally needed during development.

## Runbook
- Backend: `cd apps/backend && bun run index.ts`
- Dashboard: `cd apps/next-app && bun dev`
- CLI during dev: `cd packages/cli && bun src/index.ts ...`
- Backend must be run from `apps/backend/` so `.env` is loaded.
- Ports commonly used: dashboard `3000`, backend `3001`, x402 test `4000`, MPP test `4001`.

## Auth And Keys
| Credential | Used by | Notes |
|---|---|---|
| Privy JWT | Dashboard | Verified with Privy server auth |
| `agt_live_xxx` | SDK/backend API key | Per-agent key |
| `agt_user_xxx` | CLI/MCP/account API key | Stored in OS keychain for CLI; pass as `AGENTIS_ACCOUNT_KEY` for MCP |

## Built And Working

### Backend
Core routes:
- `/agents/*`: dashboard/user auth; create agents, update policies, initialize/read on-chain policy, send funds, regen keys, transactions.
- `/sdk/*`: API-key auth; `GET /sdk/agent`, policy update, MPP/x402 paid fetch, direct send, spend record.
- `/account/*`: account key auth for CLI; list/create hosted agents.
- `/auth/*`: CLI browser login session flow.
- `/umbra/*`: API-key Umbra privacy routes.
- `/facilitators/*`: public facilitator heartbeat and discovery routes.
- `/sol-price`: cached SOL/USD price from Jupiter Price API.

DB is still JSON at `apps/backend/data/db.json` and should be replaced later.

On-chain policy notes:
- On-chain policy agents use Quasar program `EGZKucpjMmAHvqUP3hLSBCccs4uAQyCAvQ8ikSNCryhM` on devnet.
- Backend initializes `Agent`, `Policy`, and `SpendCounter` PDAs after the agent wallet is funded.
- Policy updates for initialized on-chain agents send an on-chain transaction before saving the latest signature.
- Direct SOL sends for initialized on-chain agents prepend a policy check/record instruction before the transfer.
- Backend confirms Privy-submitted transactions before recording or returning success.

### SDK
`packages/sdk/src/client.ts` exposes:
- `AgentisClient.create({ apiKey, baseUrl })`
- `client.fetch(url)`: detects MPP/x402 402s, checks policy, pays through backend.
- `client.send(to, amountSol, mint?)`: direct transfer through backend.
- `client.policy.get/update(...)`.
- `client.privacy.status/register/balance/deposit/withdraw/createUtxo/scan/claimLatest(...)`.

MPP and x402 payments are working on devnet through backend-side Privy signing.

For on-chain policy agents, SDK policy updates and direct sends route through the same backend on-chain policy path. x402/MPP policy integration is still backend-enforced for now.

### CLI
Command: `agentis`.

Implemented:
- `agentis login/logout/whoami`
- `agentis wallet create --name <name> [--local]`
- `agentis wallet list`
- `agentis agent list/create/balance/send`
- `agentis agent create <name> --onchain-policy`
- `agentis policy get/set/init-onchain`
- `agentis fetch <url> --agent <name-or-id> [--method GET]`
- `agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet`
- `agentis earn positions <agent> --mainnet [--all]`
- `agentis earn sweep [--dry-run|--no-dry-run]`
- `agentis privacy status/register/balance/deposit/withdraw/create-utxo/scan/claim-latest --agent <name-or-id>`
- `agentis facilitator create/list/publish`

Local wallets:
- Stored under `~/.agentis/wallets/<uuid>.json` with chmod `600`.
- BIP-39 mnemonic, scrypt + AES-256-GCM, Solana path `m/44'/501'/0'/0'`.
- Local wallet vaults include `policy` and `spendHistory`.
- Local sends run `checkPolicy(...)` before signing.

### MCP
Local stdio server: `packages/mcp`.

Run:
```json
{
  "mcpServers": {
    "agentis": {
      "command": "bun",
      "args": ["/Users/awesamarth/Desktop/code/agentis/packages/mcp/src/index.ts"],
      "env": {
        "AGENTIS_ACCOUNT_KEY": "agt_user_...",
        "AGENTIS_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Implemented tools:
- `agentis_cli_help`.
- `agentis_list_agents`, `agentis_create_agent`, `agentis_agent_balance`, `agentis_send_sol`, `agentis_transactions`.
- `agentis_fetch_paid_url` for MPP/x402 paid fetch through the SDK/backend path.
- `agentis_policy_get`, `agentis_policy_check`, `agentis_policy_update`, `agentis_policy_init_onchain`, `agentis_policy_read_onchain`.
- `agentis_earn_deposit`, `agentis_earn_positions`, `agentis_earn_sweep`.
- `agentis_privacy_status/register/balance/deposit/withdraw/create_utxo/scan/claim_latest`.
- `agentis_scaffold_facilitator`, `agentis_list_facilitators`, `agentis_register_facilitator`, `agentis_publish_facilitator`.

MCP auth is account-key only. It resolves agent API keys internally from the account-owned agent list when it needs to call SDK/Umbra routes. Local encrypted-wallet vault commands are intentionally CLI-only for v1.

Tested MCP:
- `bun --check packages/mcp/src/index.ts`.
- Real stdio MCP client listed 27 tools, listed agents, read `leno` policy/balance/transactions, checked policy, fetched `https://example.com` via `agentis_fetch_paid_url`, read `agent-p` Umbra status, read `leno` Earn positions, ran Earn sweep dry-run, listed facilitator records, and returned CLI help.
- MCP paid fetch executed real devnet payments through local x402 and MPP servers: `http://localhost:4000/paid-data` and `http://localhost:4001/mpp-data` both returned `200`.
- MCP write tests created fresh hosted agents, sent devnet SOL from `leno`, initialized and updated a Quasar on-chain policy, and decoded/read the on-chain policy state.
- MCP Umbra write test on `mcp-umbra-1777639104167`: registered, deposited `1_000_000` lamports, withdrew `500_000`, created a `10_000_000` lamport UTXO, claimed UTXO `0:566`, and ended with encrypted balance `10_457_322` lamports.

### Dashboard
Implemented:
- Landing page with current Agentis branding.
- Dashboard agent list with private-agent and on-chain-agent visual treatments.
- Create-agent modal supports backend vs on-chain policy mode.
- Agent detail page with wallet balances, policy controls, tx history, Umbra controls, and on-chain policy state.
- Agent detail page has an add-funds flow that opens the connected Privy Solana wallet and sends SOL to the agent wallet.
- CLI auth page.
- Guest mode still exists via localStorage.

Token balances use devnet RPC directly. Jupiter Portfolio is mainnet-only, so do not use it for devnet dashboard balances.

### x402 Facilitators
Implemented provider-side scaffold path:
- `agentis facilitator create <name>` registers a facilitator record with the Agentis backend and scaffolds a Kora-backed x402 facilitator project.
- Generated facilitator exposes `/verify`, `/settle`, `/supported`, `/health`, and admin seller-ledger endpoints.
- Generated facilitator uses Kora as an external binary/service. Agentis does not fork or vendor Kora.
- Generated facilitator keeps a local SQLite seller ledger using Node's SQLite API and charges facilitator fees from prepaid seller balances.
- Generated facilitator sends heartbeat metrics to `/facilitators/:id/heartbeat`.
- `agentis facilitator publish <name-or-id> --url <url> --listed` opts a live facilitator into public discovery via `/facilitators/explore`.

Facilitator model:
- Sellers advertise a gross x402 price that already accounts for facilitator fees.
- The x402 payment settles to the seller.
- The facilitator deducts its fee from the seller's prepaid local balance after successful settlement.
- This avoids per-request seller transactions and avoids credit risk from unpaid invoices.

Kora:
- Local machine has `kora-cli 2.0.5` installed.
- Generated scaffold uses `@solana/kora ^0.2.1`.
- The wrapper runs via Node/tsx because `@solana/kora` currently has runtime module issues under direct Bun execution.
- x402 SVM transactions include the Solana Memo program, so generated Kora configs must allow `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.
- Default facilitator network should be `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, not plain `solana-devnet`.

Tested Kora/x402 e2e:
- `sdk-testing/kora-test` is a dedicated x402 protected server that points at `FACILITATOR_URL`.
- Kora fee payer test wallet: `Cw9XejYk1oN3uSRvLSsdmLPcrQ2mJpFYQ4Z1VqSaenhg`.
- Test keypair file is local-only under `.agentis-test-keys/` and ignored by git.
- Created devnet USDC ATA for the Kora fee-payer wallet to use it as seller/payTo.
- `agentis fetch http://localhost:4002/paid-data --agent leno` succeeded through Kora-backed facilitator for `$0.001`.
- `agentis fetch http://localhost:4002/premium-data --agent leno` succeeded through Kora-backed facilitator for `$0.005`.
- Both settlement signatures finalized on devnet:
  - `4BtXYMaMttqPeNRDjz4KkWVjUAMZEB9W1Fqs8otSrHi2LJC4K6SEPZ6GnYr59Rp6ffb1FoAXbcB2JXuYBDpyKhb7`
  - `5J15s66Ji7nHryMwMCQMrdFU3M9aksfw5umNxmawCnK6eyKD1i6rA6NhUGg3pSdJ96Nuh764a7R72GQWLx2z425U`
- Verified side effects: leno USDC decreased from `20` to `19.994`, seller/payTo USDC increased to `0.006`, facilitator ledger settled volume is `$0.006`, and prepaid seller fee balance dropped by `$0.0003` at 500 bps.

## Payment Protocol Notes

### MPP
- Use `createSolanaKitSigner` from `@privy-io/node/solana-kit`.
- Use `broadcast: true` for `solanaClient.charge()`. Pull mode caused blockhash failures.
- Detect with `WWW-Authenticate` matching `/^Payment\s+id=/i`.

### x402
- Use `createX402Client` from `@privy-io/node/x402` plus `wrapFetchWithPayment` from `@x402/fetch`.
- Do not hand-roll `ExactSvmSchemeV1` + manual Privy signing.
- x402 v2 uses `PAYMENT-REQUIRED` header, base64 JSON.
- x402 v1 may use body JSON with `x402Version`.
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- `PAY_TO` must have an existing USDC ATA on devnet.
- Amounts are atomic token units, e.g. USDC has 6 decimals.

### Policy
- Policy amounts are USD.
- On-chain policy stores USD values as micro-USD integers. `1 USD = 1_000_000 micro-USD`.
- `packages/core/src/policy.ts` is the source of truth.
- Backend/local policies use `checkPolicy(...)` before signing or proxying payment.
- On-chain policies enforce kill switch, max-per-tx, hourly, daily, monthly, and lifetime limits in the Quasar program for direct SOL sends.
- Domain allowlists remain backend-only.

## Quasar On-Chain Policy

Program location: `quasar-proj/`.

Deployed devnet program:
- `EGZKucpjMmAHvqUP3hLSBCccs4uAQyCAvQ8ikSNCryhM`

On-chain accounts:
- `Agent`: owner/agent wallet binding.
- `Policy`: kill switch, max-per-tx, hourly, daily, monthly, lifetime limits.
- `SpendCounter`: hour/day/month/lifetime spend counters.

Instructions:
- Initialize agent/policy/counter PDAs.
- Update policy.
- Check and record spend.

Tested:
- `quasar test` passes.
- Initialized on-chain policy from Agentis dashboard/backend.
- Direct SOL send succeeds with on-chain check.
- Low max-per-tx policy rejects sends with program error `0x2`.
- Backend maps no-balance simulation errors to a user-facing "add funds" message.

Important:
- Quasar is the framework used to build the Solana program. At runtime, Solana executes the deployed program and enforces its checks.
- Updating on-chain policies costs devnet SOL because it is a real transaction.
- Creating policy PDAs also costs SOL for fees and rent.
- x402/MPP do not yet route through the on-chain policy instruction path.

## Umbra Privacy

Umbra routes live in `apps/backend/src/routes/umbra.ts` and use server-side Privy wallets only.

Implemented backend routes:
- `GET /umbra/status`
- `POST /umbra/register`
- `GET /umbra/balance`
- `POST /umbra/deposit`
- `POST /umbra/withdraw`
- `POST /umbra/create-utxo`
- `GET /umbra/scan`
- `POST /umbra/claim-latest`

Implemented SDK/CLI wrappers for all of the above.

Dashboard agent page also exposes Umbra status, encrypted balance, deposit, withdraw, scan, UTXO creation, claim-latest, and registration actions for private agents.

Tested with `private-agent-1777138992`:
- Umbra direct status: registered and anonymous-ready.
- Deposit `1_000_000` lamports into encrypted wSOL balance.
- Withdraw `500_000` lamports.
- Final encrypted balance after test: `500000`.

Tested UTXO/private-transfer flow with `agent-p`:
- Starting encrypted balance: `0.0005 SOL`.
- Created a receiver-claimable UTXO from public SOL balance for `0.01 SOL`.
- Scan returned `publicReceived: 1`.
- Claim succeeded into encrypted balance.
- Final encrypted balance: `0.010457322 SOL`.
- Net credited from the UTXO claim: `0.009957322 SOL`; total protocol fee across create + claim was `0.000042678 SOL`.
- Later dashboard retest hit a stale `NullifierAlreadyBurnt` entry because the indexer still returned an already-claimed UTXO. Backend `claim-latest` now tries newest UTXOs first and skips stale already-burnt entries until the first successful claim.

Important Umbra facts:
- Devnet program: `DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ`.
- Devnet indexer: `https://utxo-indexer.api-devnet.umbraprivacy.com`.
- Devnet relayer: `https://relayer.api-devnet.umbraprivacy.com`.
- Devnet wSOL/SOL mint: `So11111111111111111111111111111111111111112`.
- Confirmed devnet Umbra deposit consumes native SOL and credits encrypted balance under the wSOL mint. Public wSOL ATA can remain zero.
- Devnet USDC failed with Umbra custom program error `#3012`; wSOL is the safe demo asset.

Encrypted balance vs UTXO:
- Encrypted balance hides amount but not linkability.
- UTXO/mixer flow hides sender-recipient link and amount, but needs ZK proving, scan, claim, and relayer.
- UTXO/private-transfer flow is now viable for demo if scripted carefully. Keep encrypted balance deposit/withdraw/status as the fallback if the relayer/indexer is flaky live.

ZK prover:
- Bun cannot run Umbra web prover cleanly because of `web-worker`/`worker_threads`.
- Backend uses `apps/backend/src/lib/node-prover.ts` to spawn a Node subprocess.
- Worker file: `apps/backend/src/lib/prover-worker.mjs`.
- First proof downloads large keys from Umbra CDN; subsequent runs are cached.

## Jupiter

Current usage:
- SOL price uses Jupiter Price API.
- `agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet` deposits mainnet USDC into Jupiter Earn.
- `agentis earn positions <agent> --mainnet [--all]` shows mainnet Jupiter Earn positions.
- `agentis earn sweep [--dry-run|--no-dry-run]` reads all hosted agents' mainnet USDC balances and deposits non-zero balances into Jupiter Earn. Default behavior prints the dry-run plan and then executes; `--dry-run` only prints; `--no-dry-run` executes directly.
- Landing page mentions swaps and Jupiter Earn. Swaps are not implemented yet.

Jupiter Earn/Lend status:
- Jupiter Earn is mainnet-only in Agentis. Do not build a devnet Jupiter Earn transaction path.
- Backend route: `POST /agents/:id/earn/deposit`.
- Backend route: `GET /agents/:id/earn/positions?network=mainnet`.
- Backend calls `POST https://api.jup.ag/lend/v1/earn/deposit`, receives a base64 unsigned legacy transaction, refreshes the blockhash, signs/sends through Privy with mainnet CAIP-2, confirms, and records the transaction.
- Backend reads positions from `GET https://api.jup.ag/lend/v1/earn/positions?users=<wallet>`.
- Amounts sent to Jupiter are atomic units. CLI accepts UI units and currently supports only mainnet USDC.
- Jupiter API key is stored locally in `apps/backend/.env` as `JUPITER_API_KEY` and is optional in code.

Tested Jupiter Earn:
- `leno` mainnet address: `77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq`.
- Pre-test mainnet balance: `0.120189671 SOL`, `5.828828 USDC`.
- Command: `agentis earn deposit leno --asset USDC --amount 1 --mainnet`.
- First attempt failed with `Blockhash not found`; fixed by refreshing blockhash before Privy signing.
- Successful finalized signature: `3ZT3RzTkT5GqvRzciB2cSBa4aJbNztVBJrnLeCRYEmZqgZpkoAcr3BtDqkMJ3GmHDQZKQFmTLW5wFMsS8AuNGyAz`.
- Post-test mainnet balance: `0.118145391 SOL`, `4.828828 USDC`.
- Jupiter Earn/share token appeared: `9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D` balance `0.960198`.
- `agentis earn positions leno --mainnet` returns `USDC 1.000062 supplied (0.960198 jlUSDC)`.

Useful Jupiter docs in this repo:
- `JUPITER.txt` is the local full docs dump; search it, do not read all at once.
- Relevant sections: Lend/Earn API, Earn deposit/withdraw, Privy Earn guide, program addresses.

## Known Working Test Assets

Hosted agents:
- `leno`: `77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq`
- `private-agent-1777138992`: `7MoLfxVg5Yww4MLNafmCCfgYe3j8cr6eVrHBpLX9L1Ws`
- On-chain policy test agent `quasar-agent-1777302205`: `BG63Grs6Uj6oBNtdoeoWhQF9AsPuaiKoMELm3vHBpvQo`

Do not casually mutate `leno` privacy flags; it is useful as a stable funded test agent.

## What Is Left

Near-term:
1. x402 facilitator/provider-side hardening: real hosted demo deployment, docs polish, seller onboarding UX, and live x402 protected API integration.
2. Jupiter Earn polish: sweep is implemented in the CLI for mainnet USDC; withdraw and dashboard positions UI can be added next.
3. Agentis skill file: a large Markdown skill that explains the Agentis ecosystem, CLI, dashboard, and MCP so other agents can load it and know how to operate Agentis. Include CLI feature coverage and note that the CLI has help commands for command discovery.
4. Demo scripting: lock the Colosseum demo path for facilitator, Earn sweep, on-chain policy, and Umbra UTXO fallback.

Medium-term:
- Add richer on-chain policy visibility, including current configured limits decoded from the policy PDA.
- Production hardening: JSON DB replacement, API key hashing, transaction history, observability, and deployment config.
- On-chain policy for x402/MPP is post-Colosseum. Do not prioritize before Colosseum unless the product direction changes.

## Reference Files
- `JUPITER.txt`: Jupiter docs dump.
- `umbra.txt`: Umbra docs dump. Huge; search only.
- `x402.txt`: x402 docs dump. Huge; search only.
- `mpp.txt`: MPP docs dump. Huge; search only.

## External References
- Jupiter docs: https://dev.jup.ag
- Umbra docs: https://docs.umbraprivacy.com
- MPP docs: https://mpp.dev
- x402 docs: https://www.x402.org
- Privy docs: https://docs.privy.io

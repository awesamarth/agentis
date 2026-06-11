# Agentis — Agent Handoff

## Product
Agentis is financial infrastructure for AI agents on Solana: wallets, payments, policy enforcement, privacy, swaps, and yield.

Positioning for the current demo: a hosted + local agent wallet platform where agents can hold funds, make MPP/x402 payments, obey spending policies, and optionally use Umbra privacy.

## Product Direction
Agentis should stay focused on controlled financial operations for agent wallets, not generic Solana actions or agent marketplaces. The useful expansion path is: give agents more safe ways to use money on Solana while keeping the user/team in control.

Near-term feature direction:
- Jupiter Swap: let agents convert assets before paying, rebalance SOL/USDC, and move incoming tokens into preferred assets.
- Jupiter Portfolio: richer agent and account-level portfolio views, including token balances and Jupiter positions.
- Jupiter Earn improvements: withdraw from Earn, improve Earn UI, and keep position display reliable.
- Transaction tags and accounting: reason/category per transaction, CSV export, per-agent spend reports, and eventually API/accounting integrations.
- Jupiter Trigger/limit orders: policy-controlled orders like "swap if SOL drops below X" or take-profit/stop-loss style actions.
- Jupiter Recurring/DCA: scheduled treasury conversion and recurring buy/sell flows.
- Jupiter Lend/Borrow later: borrow, repay, and manage collateral with strict risk policies.

Policy depth becomes more important as these actions are added: token allowlists, protocol/action allowlists, max slippage, max borrow/LTV, max daily swap volume, and stablecoin-only modes. Do not prioritize unrelated marketplace, identity/reputation, escrow, disputes, or agent-job flows unless the product direction explicitly changes.

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
    mcp/           shared tools + local stdio + remote Cloudflare Worker
  testing/
    x402-server/   local x402 test server, port 4000
    mpp-server/    local MPP test server, port 4001
    agent-app/     SDK test scripts
    umbra-test/    standalone Umbra flow test app
  quasar-proj/     Quasar on-chain policy program
```

Local packages point to `src/` directly; no package build step is normally needed during development.

## Runbook
- Backend: `cd apps/backend && bun run index.ts`
- Dashboard: `cd apps/next-app && bun dev`
- CLI during dev: `cd packages/cli && bun src/index.ts ...`
- Always use `bun x <package>`, never `bunx`. Bun's `bunx` path is unreliable
  on this machine, while `bun x` works correctly.
- Backend must be run from `apps/backend/` so `.env` is loaded.
- Ports commonly used: dashboard `3000`, backend `3001`, x402 test `4000`, MPP test `4001`.

## Current Checkpoint — June 11, 2026

The x402/MPP hardening, CLI OAuth migration, remote MCP launch, Jupiter financial
operations, and Jupiter Earn withdrawal controls are deployed.
Production is currently:

- Dashboard: `https://agentis.systems`
- Backend/OAuth issuer: `https://api.agentis.systems`
- Docs: `https://docs.agentis.systems`
- Remote MCP: `https://mcp.agentis.systems/mcp`
- Published CLI: `@agentis-hq/cli@0.4.1`
- Published MCP package: `@agentis-hq/mcp@0.2.1`
- Latest handoff commits:
  - `5d84698` — Jupiter swap, portfolio, token search, and recurring rails
  - `6b99fff` — CLI command validation fix and `0.4.1` release
  - `0f42930` — Jupiter Earn withdrawal controls and MCP `0.2.1`
  - `0923e93` — remove token search and recurring controls from the frontend

Production configuration:
- Railway service `backend` is linked to the `agentis` project and is online.
- Railway has `PUBLIC_API_URL=https://api.agentis.systems`,
  `DASHBOARD_URL=https://agentis.systems`, and `MCP_INTROSPECTION_SECRET`.
- Cloudflare Worker `agentis-mcp` has the matching introspection secret.
- `agentis.systems` uses Cloudflare nameservers
  `gordon.ns.cloudflare.com` and `heather.ns.cloudflare.com`.
- Existing root/API/docs/www records were migrated as DNS-only; MCP is proxied
  to the Worker.

Production deploy runbook:
- Backend deploys from the connected Railway service after changes reach its
  configured branch.
- Dashboard/docs use their existing Vercel deployments.
- Remote MCP Worker changes require a separate deploy from `packages/mcp`:
  `bun run build:worker`, then
  `bun x wrangler deploy --domain mcp.agentis.systems`.
- Use `bun x`, never `bunx`, for package executables in this repo.
- Worker config is `packages/mcp/wrangler.toml`. Keep
  `MCP_INTROSPECTION_SECRET` identical in Railway and the Worker.

Verified production remote MCP flow:
- OAuth protected-resource and authorization-server discovery.
- Dynamic client registration and PKCE browser consent.
- Resource-bound access token exchange and private introspection.
- Streamable HTTP initialize, 31-tool listing, and sanitized agent listing.
- A no-op policy update on `cli-test-agent` succeeded with only
  `wallets:read policy:read policy:write`; `wallets:write` was not granted.
- Test refresh tokens were revoked after E2E.
- Test harness: `testing/remote-mcp-oauth.ts`; set
  `AGENTIS_MCP_TEST_MODE=write` for the scoped write test.

Important caveats:
- The root `.env` currently contains a Cloudflare API token as a raw single
  line, not `KEY=value`. It is gitignored. Never print or commit it; rotate it
  when administrative setup is finished.
- npm CLI `0.4.1` includes the Jupiter commands and strict command validation.
- JSON DB remains the main production durability/scaling risk.
- Remote MCP local-wallet operations remain intentionally unsupported.

Current Jupiter checkpoint:
- Jupiter Swap V2, Tokens V2 search, Portfolio, and time-based Recurring/DCA are
  deployed across backend, SDK, CLI, and MCP.
- The per-agent dashboard intentionally exposes Swap and Portfolio only. Token
  Search and Recurring Orders remain available through CLI, SDK, and MCP but
  were removed from the frontend to keep the interface focused.
- Public naming is provider-neutral: `agentis swap`, `agentis tokens search`,
  `agentis portfolio`, and `agentis recurring`. Do not add an
  `agentis jupiter` command namespace.
- New policy controls are token mint allowlists, max slippage BPS, and max
  rolling 24-hour swap/recurring volume.
- Live read-only/build validation passed for token search, SOL-to-USDC Swap V2
  order construction, `leno` Portfolio, recurring-order listing, and unsigned
  recurring-order construction. No mainnet swap or recurring transaction was
  signed or executed during this pass.
- The live Recurring API currently requires `includeFailedTx=false` even though
  the docs describe it as optional, returns orders under `time`, and requires
  numeric `inAmount`; the backend normalizes these quirks.
- Jupiter Earn supports deposit, positions, partial withdrawal, full redeem,
  and account-wide withdrawal controls. The remote MCP Worker and npm MCP
  package include `agentis_earn_withdraw`.
- New OAuth logins request `jupiter:read` and `jupiter:write`; credentials
  created before the Jupiter deployment must re-login to receive those scopes.

## Next Work

Recommended order:
1. Deploy an OpenClaw or Hermes agent connected to Agentis and record a real
   end-to-end demo of the agent using Agentis financial tools.
2. Test remote MCP from real third-party hosts such as Codex and Claude, not
   only the SDK harness.
3. Database migration away from JSON while preserving key hashes, OAuth
   clients/grants, agents, policies, transactions, and facilitator records.
4. Mainnet-readiness pass: secrets, rate limits, audit logs, token/action
   allowlists, RPC reliability, monitoring, and production transaction limits.

Do not redo the completed OAuth/MCP deployment unless a regression is observed.

## Umbra RC SDK
The backend uses `@umbra-privacy/sdk@5.0.0-rc.6`, which directly pins
`@umbra-privacy/umbra-codama@3.0.0-rc.6`. The Umbra SDK/docs are unstable
enough that new changes must inspect installed package exports/types/dist and
the current `umbra-defi/examples` repo instead of relying on older assumptions.

Current Umbra migration state:
- RC6 migration passed locally on June 11, 2026 with fresh hosted agent
  `umbra-rc6-1781179779` (`4NgQtMrrSSky5UiAyasaqQwRTcmCuuBz8ymN5CPM3p63`):
  registration, wSOL encrypted deposit, encrypted-balance-sourced self UTXO
  creation, native scan, and claim-latest all returned `200`.
- The final focused cycle deposited `100_000` atomic wSOL, created a `100_000`
  atomic self UTXO, and claimed `99_653` atomic back into the encrypted balance.
- Umbra RPC is configurable through `UMBRA_DEVNET_RPC_URL` and
  `UMBRA_DEVNET_ACCOUNT_RPC_URL`. Both are set locally to an Alchemy devnet RPC;
  never commit or print the URL because it contains the API key.
- Use native RC6 scanning. The old custom columnar indexer decoder was removed;
  it populated the note version incorrectly and caused
  `version[0] must not be zero` during claims.
- The backend injects polling transaction and computation monitors so Umbra does
  not depend on public Solana WebSocket reliability.
- `GET /umbra/scan`, direct encrypted-balance deposit/withdraw, encrypted-balance-sourced UTXO creation, and `claim-latest` were retested locally against the backend on May 30, 2026.
- Live hosted CLI demo passed on May 31, 2026 with fresh agents `live-umbra-rc-0531` and `live-umbra-rc-recv-0531`: register, wSOL encrypted deposit, withdraw, self UTXO create/scan/claim, cross-agent receiver UTXO create/scan/claim, and stale already-claimed retry handling all succeeded.
- Scan must not call `ensureUmbraMintKey`; repair/rotation is unrelated to scanning and caused misleading logs.
- `create-utxo` now uses encrypted balance as the source (`ETA -> stealth pool`) instead of public ATA. Self UTXO and cross-agent receiver UTXO flows both claimed successfully through the local backend.
- `claim-latest` handles stale indexer rows by skipping `NullifierAlreadyBurnt` entries and treating Umbra relayer `completed` status as success.
- Do not chase `repair` unless explicitly working on registration/mint-key rotation. For the current debugging path, fix and test one Umbra operation at a time.

## Auth And Keys
| Credential | Used by | Notes |
|---|---|---|
| Privy JWT | Dashboard | Verified with Privy server auth |
| `agt_live_xxx` | SDK/backend API key | Per-agent key; full key shown only on create/regenerate |
| `agt_user_xxx` | Account API key / local stdio MCP | Full key shown only on generate; pass as `AGENTIS_ACCOUNT_KEY` for local stdio MCP |
| `agt_oauth_xxx` + `agt_refresh_xxx` | CLI and remote MCP OAuth | Stored as an OAuth credential bundle in the OS keychain for CLI; remote MCP keeps credentials client-side |

Key storage:
- `apps/backend/data/db.json` stores only HMAC-SHA256 key hashes plus masked metadata (`prefix`, `suffix`, `masked`).
- Runtime plaintext key recovery material is in gitignored `apps/backend/data/key-secrets.json`.
- Set `API_KEY_HASH_SECRET` in production and keep it stable. Local dev falls back to a deterministic dev secret.
- Normal agent/account reads return masked keys only. Agent API keys are returned only on agent create/regenerate; account keys are returned only on account key generate.
- New CLI logins use OAuth authorization code + PKCE. Legacy `/auth/session` clients remain supported and reuse the existing account key instead of rotating it.

## Built And Working

### Backend
Core routes:
- `/agents/*`: dashboard/user auth; create agents, update policies, initialize/read on-chain policy, send funds, regen keys, transactions.
- `/sdk/*`: API-key auth; `GET /sdk/agent`, policy update, MPP/x402 paid fetch, direct send, spend record.
- `/account/*`: Privy JWT, account-key, or scoped OAuth auth; list/create hosted agents.
- `/auth/*`: legacy CLI browser login session flow.
- `/oauth/*`: OAuth authorization, consent completion, token/refresh, revocation, dynamic client registration, and MCP introspection.
- `/umbra/*`: API-key Umbra privacy routes.
- `/facilitators/*`: facilitator heartbeat route used by CLI-generated facilitator scaffolds.
- `/sol-price`: cached SOL/USD price from Jupiter Price API.

DB is still JSON and should be replaced later.

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
- `agentis wallet list [--json]`
- `agentis agent create/balance/send`
- `agentis agent create <name> --onchain-policy`
- `agentis policy get/set/init-onchain`
- `agentis fetch <url> --agent <name-or-id> [--method <method>]`
- `agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet`
- `agentis earn withdraw <agent> --asset USDC [--amount <amount>] --mainnet`
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
`packages/mcp` contains shared MCP tools, a local stdio entrypoint, and a
stateless Cloudflare Streamable HTTP Worker.

Remote MCP implementation:
- Endpoint path: `/mcp`.
- OAuth protected-resource metadata:
  `/.well-known/oauth-protected-resource`.
- OAuth authorization server is implemented by backend `/oauth/*` routes with
  authorization code + PKCE, refresh-token rotation, revocation, dynamic client
  registration, and private token introspection.
- Remote access tokens are resource-bound and independently revocable. The
  Worker stores no user credentials.
- Build with `cd packages/mcp && bun run build:worker`.
- Production endpoint: `https://mcp.agentis.systems/mcp`.
- Remote MCP OAuth E2E passed on June 8, 2026: dynamic client registration,
  PKCE consent, token exchange, Streamable HTTP initialization, 31-tool listing,
  sanitized `agentis_list_agents`, and a no-op `agentis_policy_update` using only
  `wallets:read policy:read policy:write`. The test grant was revoked afterward.
- `agentis_list_agents` intentionally returns a compact safe projection. Do not
  reintroduce key hashes, wallet IDs, or full transaction histories.
- Policy writes use dedicated `PATCH /agents/:id/policy`, allowing
  `policy:write` without `wallets:write`.

Local stdio run:

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

Local stdio auth remains account-key based for compatibility. Remote MCP uses
OAuth. Both resolve agent API keys internally from the account-owned agent list
when needed. Local encrypted-wallet vault commands are intentionally CLI-only
for v1.

Tested MCP:
- `bun --check packages/mcp/src/index.ts`.
- Real stdio MCP client listed agents, read `leno` policy/balance/transactions, checked policy, fetched `https://example.com` via `agentis_fetch_paid_url`, read `agent-p` Umbra status, read `leno` Earn positions, ran Earn sweep dry-run, and returned CLI help.
- MCP paid fetch executed real devnet payments through local x402 and MPP servers: `http://localhost:4000/paid-data` and `http://localhost:4001/mpp-data` both returned `200`.
- MCP write tests created fresh hosted agents, sent devnet SOL from `leno`, initialized and updated a Quasar on-chain policy, and decoded/read the on-chain policy state.
- MCP Umbra write test on `mcp-umbra-1777639104167`: registered, deposited `1_000_000` lamports, withdrew `500_000`, created a `10_000_000` lamport UTXO, claimed UTXO `0:566`, and ended with encrypted balance `10_457_322` lamports.
- After key hashing migration, MCP still lists agents without plaintext API keys, fetches `https://example.com`, and reads Umbra status via account-auth proxy routes.

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
- `agentis facilitator publish <name-or-id> --url <url> --listed` stores public URL/listing metadata for a generated facilitator.

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
- `testing/kora-test` is a dedicated x402 protected server that points at `FACILITATOR_URL`.
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
- Preserve the original HTTP method, headers, and body when retrying after 402.
- GET, POST, and PATCH paid flows are covered by conformance tests.

### x402
- Use `createX402Client` from `@privy-io/node/x402` plus `wrapFetchWithPayment` from `@x402/fetch`.
- Do not hand-roll `ExactSvmSchemeV1` + manual Privy signing.
- x402 v2 uses `PAYMENT-REQUIRED` header, base64 JSON.
- x402 v1 may use body JSON with `x402Version`.
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- `PAY_TO` must have an existing USDC ATA on devnet.
- Amounts are atomic token units, e.g. USDC has 6 decimals.
- Preserve the original HTTP method, headers, and body when retrying after 402.
- Standards/paywall tests live in `testing/protocol-conformance.ts`,
  `testing/agent-app/paid-methods.ts`, and
  `testing/agent-app/paywall-interoperability.ts`.

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
- Kill switch rejects sends for both backend-mode and initialized on-chain policy agents. Latest focused test used fresh agents `ks-backend-1777654074600` and `ks-onchain-1777654074600`; both were restored to `killSwitch: false`.
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

Historical pre-RC UTXO/private-transfer test with `agent-p`:
- This older test created the UTXO from public SOL. It is retained as protocol
  history only; the current `create-utxo` path uses encrypted balance as its
  source, as documented in the RC migration state above.
- Starting encrypted balance: `0.0005 SOL`.
- Created a receiver-claimable UTXO from public SOL balance for `0.01 SOL`.
- Scan returned `publicReceived: 1`.
- Claim succeeded into encrypted balance.
- Final encrypted balance: `0.010457322 SOL`.
- Net credited from the UTXO claim: `0.009957322 SOL`; total protocol fee across create + claim was `0.000042678 SOL`.
- Later dashboard retest hit a stale `NullifierAlreadyBurnt` entry because the indexer still returned an already-claimed UTXO. Backend `claim-latest` now tries newest UTXOs first and skips stale already-burnt entries until the first successful claim.

Tested cross-agent UTXO/private-transfer flow:
- Sender: `agent-p` (`7MoLfxVg5Yww4MLNafmCCfgYe3j8cr6eVrHBpLX9L1Ws`).
- Receiver: `mcp-umbra-1777639104167` (`CjGXrfn72cP7DmEFnxac2SkuUxs4emf5r2B5aa1ve6zy`).
- Sender created a `0.001 SOL` receiver-claimable UTXO to receiver.
- Receiver scan showed `publicReceived: 2`.
- Receiver `claim-latest` succeeded on UTXO `0:571`.
- Receiver encrypted balance moved from `0.010457322 SOL` to `0.011453055 SOL`, net credit `0.000995733 SOL`.
- Indexer still showed stale `publicReceived: 2` after claim; claim path remains robust because it skips already-burnt/stale UTXOs.

Important Umbra facts:
- Devnet program: `DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ`.
- Devnet indexer: `https://utxo-indexer.api-devnet.umbraprivacy.com`.
- Devnet relayer: `https://relayer.api-devnet.umbraprivacy.com`.
- Umbra devnet demo/testing currently works with wSOL plus dUSDC/dUSDT:
  - wSOL/SOL mint: `So11111111111111111111111111111111111111112`
  - dUSDC: `4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7`
  - dUSDT: `DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6`
- wSOL direct encrypted-balance deposit was retested after Umbra re-initialized devnet and is now confirmed working locally: `scan-fresh-1780145672` deposited `1_000_000` atomic wSOL and encrypted balance became `shared`, `1000000`.
- dUSDC direct encrypted-balance deposit was confirmed working locally: `scan-fresh-1780145672` deposited `1_000_000` atomic dUSDC and encrypted balance became `shared`, `1000000`.
- wSOL self UTXO claim was confirmed locally: `scan-fresh-1780145672` created a `100_000` atomic wSOL self UTXO and claim-latest credited `99_574` atomic wSOL back to encrypted balance.
- wSOL cross-agent UTXO claim was confirmed locally: `scan-fresh-1780145672` sent a `100_000` atomic wSOL receiver UTXO to `umbra-rc-test-177`; receiver scan showed `received: 1`, and claim-latest credited `99_574` atomic wSOL.
- Live hosted demo agents:
  - `live-umbra-rc-0531` (`7jdbxG4cmQcqwpXJLuXygmGitexJ5wJ3kAs4y3LbENB8`) final encrypted wSOL after tests: `799_574` atomic.
  - `live-umbra-rc-recv-0531` (`4XSQbVz6jckcLQSk2RYQHgHD3K3o7KpmitZ5VEqJasnt`) final encrypted wSOL after receiver claim: `99_574` atomic.

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
- Swap V2 quote/execute, Tokens V2 search, Portfolio, and time-based
  Recurring/DCA are implemented for backend, SDK, CLI, and MCP. The per-agent
  dashboard exposes Swap and Portfolio only.
- CLI commands are `agentis swap quote|execute`, `agentis tokens search`,
  `agentis portfolio`, and `agentis recurring list|create|cancel`.
- SDK surfaces are `client.swap`, `client.tokens`, `client.portfolio`, and
  `client.recurring`; there is intentionally no `client.jupiter` namespace.
- `agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet` deposits mainnet USDC into Jupiter Earn.
- `agentis earn positions <agent> --mainnet [--all]` shows mainnet Jupiter Earn positions.
- `agentis earn withdraw <agent> --asset USDC [--amount <amount>] --mainnet`
  withdraws a specified amount or redeems the full position when amount is omitted.
- `agentis earn sweep [--dry-run|--no-dry-run]` reads all hosted agents' mainnet USDC balances and deposits non-zero balances into Jupiter Earn. Default behavior prints the dry-run plan and then executes; `--dry-run` only prints; `--no-dry-run` executes directly.
- Swap and Recurring writes are mainnet-only and policy-controlled.

Jupiter Earn/Lend status:
- Jupiter Earn is mainnet-only in Agentis. Do not build a devnet Jupiter Earn transaction path.
- Backend route: `POST /agents/:id/earn/deposit`.
- Backend route: `POST /agents/:id/earn/withdraw`.
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
- `reference-dumps/JUPITER.txt` is the local full docs dump; search it, do not read all at once.
- Relevant sections: Lend/Earn API, Earn deposit/withdraw, Privy Earn guide, program addresses.
- For new Jupiter work, prioritize Swap, Portfolio, Earn withdraw, Trigger/limit orders, Recurring/DCA, then Lend/Borrow. Ignore Prediction, Studio token creation, Lock/vesting, Perps, and Jupiter Plugin unless explicitly requested.

## Known Working Test Assets

Hosted agents:
- `leno`: `77rKFXbTbWQMXeQ97AYwThPcuh8sotTtz3jssRMRszGq`
- `private-agent-1777138992`: `7MoLfxVg5Yww4MLNafmCCfgYe3j8cr6eVrHBpLX9L1Ws`
- On-chain policy test agent `quasar-agent-1777302205`: `BG63Grs6Uj6oBNtdoeoWhQF9AsPuaiKoMELm3vHBpvQo`

Do not casually mutate `leno` privacy flags; it is useful as a stable funded test agent.


## Reference Files
- Reference dumps now live under `reference-dumps/`, not the repo root.
- `reference-dumps/JUPITER.txt`: Jupiter docs dump.
- `reference-dumps/umbra.txt`: Umbra docs dump. Huge; search only.
- `reference-dumps/x402.txt`: x402 docs dump. Huge; search only.
- `reference-dumps/mpp.txt`: MPP docs dump. Huge; search only.

## External References
- Jupiter docs: https://dev.jup.ag
- Umbra docs: https://docs.umbraprivacy.com
- MPP docs: https://mpp.dev
- x402 docs: https://www.x402.org
- Privy docs: https://docs.privy.io

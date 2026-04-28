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
    mcp/           placeholder, not built
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
| `agt_user_xxx` | CLI/account API key | Stored in OS keychain |

## Built And Working

### Backend
Core routes:
- `/agents/*`: dashboard/user auth; create agents, update policies, initialize/read on-chain policy, send funds, regen keys, transactions.
- `/sdk/*`: API-key auth; `GET /sdk/agent`, policy update, MPP/x402 paid fetch, direct send, spend record.
- `/account/*`: account key auth for CLI; list/create hosted agents.
- `/auth/*`: CLI browser login session flow.
- `/umbra/*`: API-key Umbra privacy routes.
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
- `agentis privacy status/register/balance/deposit/withdraw/create-utxo/scan/claim-latest --agent <name-or-id>`

Local wallets:
- Stored under `~/.agentis/wallets/<uuid>.json` with chmod `600`.
- BIP-39 mnemonic, scrypt + AES-256-GCM, Solana path `m/44'/501'/0'/0'`.
- Local wallet vaults include `policy` and `spendHistory`.
- Local sends run `checkPolicy(...)` before signing.

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

Dashboard agent page also exposes Umbra status, encrypted balance, deposit, withdraw, scan, and registration actions for private agents.

Tested with `private-agent-1777138992`:
- Umbra direct status: registered and anonymous-ready.
- Deposit `1_000_000` lamports into encrypted wSOL balance.
- Withdraw `500_000` lamports.
- Final encrypted balance after test: `500000`.

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
- For the demo, prefer encrypted balance deposit/withdraw/status unless private transfer anonymity is explicitly needed.

ZK prover:
- Bun cannot run Umbra web prover cleanly because of `web-worker`/`worker_threads`.
- Backend uses `apps/backend/src/lib/node-prover.ts` to spawn a Node subprocess.
- Worker file: `apps/backend/src/lib/prover-worker.mjs`.
- First proof downloads large keys from Umbra CDN; subsequent runs are cached.

## Jupiter

Current usage:
- SOL price uses Jupiter Price API.
- Landing page mentions swaps and Jupiter Earn, but Earn is not implemented.

Jupiter Earn/Lend status:
- Jupiter docs say Jupiter programs are deployed on Solana mainnet only.
- Earn examples use mainnet RPC and mainnet program IDs.
- Do not build a devnet Jupiter Earn transaction path. For current devnet demo, show Earn as a planned/mainnet-only feature or simulate UI state only.

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
1. x402 facilitator/provider-side work. This is the top priority for making Agentis feel like infrastructure.
2. Jupiter work: swaps/auto-swap first; Earn is mainnet-only and likely roadmap/mock for devnet.
3. MCP server exposing Agentis tools.
4. Agentis skill file: a large Markdown skill that explains the Agentis ecosystem, CLI, dashboard, and MCP so other agents can load it and know how to operate Agentis. Include CLI feature coverage and note that the CLI has help commands for command discovery.
5. Umbra demo choice: decide whether to demo UTXO/private transfer or keep demo focused on encrypted balance.
6. Production hardening: JSON DB replacement, API key hashing, transaction history, and observability.

Medium-term:
- Add richer on-chain policy visibility, including current configured limits decoded from the policy PDA.
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

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
- `/agents/*`: dashboard/user auth; create agents, update policies, send funds, regen keys, transactions.
- `/sdk/*`: API-key auth; `GET /sdk/agent`, policy update, MPP/x402 paid fetch, direct send, spend record.
- `/account/*`: account key auth for CLI; list/create hosted agents.
- `/auth/*`: CLI browser login session flow.
- `/umbra/*`: API-key Umbra privacy routes.
- `/sol-price`: cached SOL/USD price from Jupiter Price API.

DB is still JSON at `apps/backend/data/db.json` and should be replaced later.

### SDK
`packages/sdk/src/client.ts` exposes:
- `AgentisClient.create({ apiKey, baseUrl })`
- `client.fetch(url)`: detects MPP/x402 402s, checks policy, pays through backend.
- `client.send(to, amountSol, mint?)`: direct transfer through backend.
- `client.policy.get/update(...)`.
- `client.privacy.status/register/balance/deposit/withdraw/createUtxo/scan/claimLatest(...)`.

MPP and x402 payments are working on devnet through backend-side Privy signing.

### CLI
Command: `agentis`.

Implemented:
- `agentis login/logout/whoami`
- `agentis wallet create --name <name> [--local]`
- `agentis wallet list`
- `agentis agent list/create/balance/send`
- `agentis policy get/set`
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
- Dashboard agent list with private-agent visual treatment.
- Agent detail page with wallet balances, policy controls, tx history, and Umbra registration status/action.
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
- `packages/core/src/policy.ts` is the source of truth.
- Check policy before signing or proxying payment.

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

Do not casually mutate `leno` privacy flags; it is useful as a stable funded test agent.

## What Is Left

Near-term:
1. Dashboard privacy actions beyond registration: status, encrypted balance, deposit, withdraw, scan.
2. Decide whether to demo Umbra UTXO/private transfer or keep demo focused on encrypted balance.
3. Facilitator network work for x402/MPP provider side. User will specify this separately.
4. MCP server exposing Agentis tools.
5. Jupiter swap/facilitator path: auto-swap SOL to required payment token when needed.
6. Jupiter Earn: mainnet-only; likely not part of devnet demo except as roadmap or mocked UI.

Medium-term:
- Replace JSON DB with SQLite/Postgres.
- Hash API keys and show plaintext only once.
- On-chain policy/registry with Quasar.
- Better typed backend Hono variables; current full backend `tsc` has pre-existing route variable typing errors.
- Production-grade transaction history and observability.

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

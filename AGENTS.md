# Agentis — working context

Current snapshot, not a diary. Keep implemented, verified and pending work distinct. Historical detail belongs in Git.

## Working agreement

- Follow the owner's next small request; no unsolicited rewrites or speculative compatibility layers.
- Batch meaningful changes into local commits. Never push, publish or deploy unless explicitly asked.
- Do not use subagents or run browser checks unless the owner lifts the restriction.
- Prefer Bun 1.3.14 and installed libraries/exact local types. Validate proportionately with targeted builds/typechecks.
- Preserve unrelated dirty files and private local data. Never print secrets, keys, tokens or credential-bearing URLs.
- Testnet/local only. Mainnet spending is not authorized.

## Product and authority

Agentis provides independent agent wallets, shared USD budgets, approvals and receipts through one backend/database/worker. Dashboard, SDK, CLI and remote MCP use the same operation pipeline.

- Default EVM network: Base. Supported testnets: Base Sepolia, Ethereum Sepolia, Arc, Tempo and Solana Devnet.
- Per-agent limits: transaction, rolling hourly/daily and lifetime USD, including fees across enabled networks. Null is uncapped; zero blocks.
- Modes: `ask`, `automatic`, `paused`. Agents cannot approve themselves.
- Hosted custody uses Privy. Current wallets use an accepted 1-of-2 user + server authorization-key quorum. Agentis enforces spending rules in its backend; do not claim independent Privy policy enforcement.
- Owner auth is a Privy access JWT. Executor grants are agent/wallet scoped and cannot manage rules, issue keys, export wallets or approve payments.
- Local CLI wallets are a separate plaintext, filesystem-protected custody model. Anyone with the key file can bypass CLI policy.

## Execution invariants

`authenticate → validate → reserve budget → approve/authorize → persist proof → submit → reconcile → receipt`

- Validate network, asset, recipient, calldata/instructions, amount and maximum fees. Use bigint atomic amounts and decimal strings.
- Use fresh USD prices and fail closed on missing/stale quotes. Reserve amount plus maximum fees and settle actual amount/fees.
- Preserve owner locks, transactional idempotency, expiring exact approvals and execution-time scope/policy/plugin checks.
- Persist signed bytes/hash before submission; never expose them. Unknown submissions retain reservations and reconcile—never blindly resend.
- Pausing/revoking cannot undo submitted transactions.
- Paid HTTP remains GET-only and must preserve SSRF, DNS, redirect, timeout and body limits.

## Implemented

### Core payments

- Hosted and local direct transfers across supported testnets.
- Base/Arc/Solana x402 and Tempo MPP paid GET requests.
- Hash-first reconciliation, fee-inclusive USD accounting and same-key idempotent retries.
- Production frontend: `https://www.agentis.systems`; backend: `https://api.agentis.systems`.
- Railway service is `backend`; leave Hermes untouched and always pass `--service backend`.

### Plugins

Plugins are per-agent and live under `apps/backend/src/plugins/`. `plugins/registry.ts` is the single backend registration point for metadata, routes, policy reasons, disable hooks and worker ticks; shared IDs come from `packages/core/src/operations.ts`. Dashboard metadata/rendering is centralized in `components/plugins/registry.tsx`.

- `plugins/uniswap/`: Base Sepolia V3 quote/swap, exact allowance, manual rebalance targets, DCA, gas refill and optional Base x402 USDC shortfall funding.
- `plugins/ens/`: ENSv2 subname setup, explicit multichain payment records, narrow endpoint/description delegation and internal ERC-8004 registration. ERC-8004 is never a separate plugin.
- `apps/backend/src/plugins.ts` currently keeps disabled future-plugin configuration placeholders; leave it alone until those integrations are implemented.

All plugin execution still goes through Agentis policy, approval, signing and reconciliation. Plugins never receive unrestricted signer/key access.

### Interfaces

- CLI supports browser login, hosted/local wallet views, balances, sends, policy/history, paid fetch, operations, Uniswap and ENS.
- SDK is a thin backend client for hosted operations, administration, consent, Uniswap and ENS. Old seller-side `@agentis-hq/sdk/server` helpers were removed.
- Remote MCP is mounted at `/mcp` with OAuth + PKCE, explicit agent/network consent and live grant checks. It exposes no approval, policy-edit or key-export tools.
- Dashboard supports onboarding, balances, rules, approvals, access keys, plugins, activity and profile analytics. Owner balance cards share one backend request; balance display uses Alchemy Portfolio batching for Base/Arc/Ethereum Sepolia, direct RPC reads for Tempo/Solana, short in-memory caching and explicit partial results. Display estimates never authorize spending.

## Verified vs pending

Verified with real testnet activity: hosted/local transfers, Base/Arc/Solana x402, Tempo MPP, production Arc send, one Base Sepolia Uniswap swap, ENS namespace/records/delegation and ERC-8004 registration. Focused fake-signer and local checks cover authorization, budgets, scheduling and MCP OAuth.

Still pending:

- Actual external MCP client + Privy browser-consent/payment flow.
- ENS agent-signed record update and payment-to-name live verification.
- Additional live scheduled/funding Uniswap execution.
- Automatic release for provably unused expired Tempo/Solana payments and stronger unknown-submission recovery.
- Rate limits, pagination, webhooks and operator recovery tooling.
- Owner-deferred fiat funding: treat onramp/offramp as owner-only core wallet flows, not plugins. Privy + Meld/Onramp Money is the leading India/INR onramp candidate, but requires Meld KYB, a Privy React SDK upgrade and live regional verification; real providers fund mainnets, so do not silently target testnet wallet counterparts. Offramp remains later because Privy/Bridge does not document INR payout rails.
- Owner-tracked product TODOs, not approved implementation yet: Monid plugin (inspect its exact x402/MPP contracts first); possible Meta Muse integration (official material establishes Link’s wallet for agents is built into Muse, but not a public Muse connector platform); and a product/architecture decision between AgentCard and Link agent payments. Determine each option’s exact custody, approval, credential-handling, availability and integration contracts before deciding whether it is a core payment rail or an optional plugin. Link Financial Insights is a separate optional data integration, not part of payment core, and remains deferred.

Do not pursue Privy user-JWT exchange, existing-wallet migration, Umbra or hosted bot work unless explicitly reopened.

## Repository map

- `apps/backend/src/app.ts`, `operations.ts`, `runtime.ts`, `worker.ts`: API and execution lifecycle.
- `apps/backend/src/modules/`: shared network/payment/accounting modules.
- `apps/backend/src/plugins/`: integration-specific implementations.
- `apps/backend/src/db/`, `drizzle/`: schema and explicit SQL migrations.
- `apps/next-app/`: dashboard and owner approval/consent flows.
- `packages/core`: shared contracts.
- `packages/sdk`: HTTP client.
- `packages/cli`: hosted and local CLI.
- `packages/mcp`: remote MCP tools.
- `testing/`: standalone focused checks and protocol fixtures; no root automated test suite.

## Local runtime and validation

- Dashboard `3000`, API `3001`, Postgres `127.0.0.1:55432` under Compose project `agentis-rewrite`.
- Start backend processes from `apps/backend` so its private environment loads.
- Core/SDK/MCP exports resolve to `dist`; run `bun run build:packages` after contract changes.
- Standard validation: `bun run check`; use narrower package checks for small changes.
- Do not restart execution against a stale local database snapshot.
- No browser verification unless explicitly authorized.

Existing test agent: `research-agent` (`3068f575-d2d1-4ac8-a737-25841fef7fae`), ask mode. Do not create agents, move funds or alter unrelated paused states without consent.

## Sensitive and unrelated local state

Private: root/backend environment files, `.agentis-test-keys/`, `data/key-secrets.json`, CLI/wallet files, authorization keys and RPC credentials. `privy-server-authorization.key` is a P-256 authorization key, not a wallet private key.

Preserve unrelated dirty paths, including `apps/docs/next-env.d.ts`, `testing/x402-server/index.ts`, `apps/next-app/AGENTS.md 04-33-15-918.md` and `testing/umbra-test/AGENTS.md` if present. Never blanket reset or clean the worktree.

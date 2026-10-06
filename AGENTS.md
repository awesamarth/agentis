# Agentis — working context

Current snapshot, not a diary. Keep implemented, verified and pending work distinct. Historical detail belongs in Git.

## Working agreement

- Follow the owner's next small request; no unsolicited rewrites or speculative compatibility layers.
- Never push, publish or deploy unless explicitly asked.
- Do not use subagents or run browser checks unless the owner lifts the restriction.
- Prefer Bun 1.3.14 and installed libraries/exact local types. Validate proportionately with targeted builds/typechecks.
- Preserve unrelated dirty files and private local data. Never print secrets, keys, tokens or credential-bearing URLs.
- Testnet/local only. Mainnet spending is not authorized.

## Product and authority

Agentis provides independent agent wallets, shared USD budgets, approvals and receipts through one backend/database/worker. Dashboard, SDK, CLI and remote MCP use the same operation pipeline.

- Developer-owned catalog: `packages/core/src/networks.ts`. Source defaults to Base mainnet; mainnet Base/Ethereum/Tempo/Solana and opt-in Base Sepolia/Ethereum Sepolia/Arc/Tempo Testnet/Solana Devnet. No user-defined networks. Retire entries with `enabled: false`, preserving reconciliation/history metadata. New execution families still need explicit adapters; see `docs/networks.md`.
- Per-agent limits: transaction, rolling hourly/daily and lifetime USD, including fees across enabled networks. Mainnet and testnet usage are separated, with the same configured limits applied independently. Null is uncapped; zero blocks.
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

- Hosted/local transfer, x402 and Tempo MPP network routing is catalog-driven. Tempo allowlist: OUSD/USDC.e/pathUSD on both environments, plus alphaUSD only on testnet; no betaUSD/thetaUSD. OUSD defaults for new selections. Payment and fee tokens are independently bound to approval; testnet USDC.e is not fee-eligible and defaults to OUSD fees at creation. Older implicit fee semantics remain unchanged. See `docs/tempo.md`.
- Tempo pricing: signature/quorum-verified fresh RedStone pathUSD/canonical-USDC packages and direct CoinGecko Open USD quotes; no stale-price/$1 spending fallback. USDC pricing does not establish bridge solvency. MPP selects and persists one exact supported offer; only unsponsored pull-mode charge is supported, not sessions/splits/auto-swaps.
- Mainnet support and Tempo hardening are implemented locally, not deployed or live-spending verified by these changes.
- Onboarding/settings have an Enable testnets toggle; disabling it removes testnets from the selection. Disabled wallets are filtered before balance/RPC reads.
- Mainnet-only USD balance/profile totals; testnet token balances and activity stay separate. Display responses/prices cache for 120 seconds, with display-only USDC=$1. Spending prices remain fresh and fail-closed.
- Local wallet format is v4. Older aliases are rejected without modifying private files, rather than silently treating former testnet consent as mainnet consent.
- Base transfer preparation includes the serialized transaction’s estimated L1 fee with 2× headroom. This is a conservative estimate, not an on-chain ceiling on future L1 fee movement.
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

Verified with real testnet activity: hosted/local transfers, Base/Arc/Solana x402, Tempo MPP, production Arc send, one Base Sepolia Uniswap swap, ENS namespace/records/delegation and ERC-8004 registration. Owner considers ENS identity setup done; do not keep it as the next polishing task. Separate agent-signed record-update and payment-to-name live checks remain pending below. Owner verified production ChatGPT web MCP connection/payment, revocation and non-consented wallet rejection. Focused fake-signer and local checks cover authorization, budgets, scheduling and MCP OAuth.

Tempo hardening verification: offline token/fee/MPP/oracle regressions, the installed MPP client with fake RPC/signing, and isolated approval/accounting/unknown-submission checks pass. Live read-only probes verified all listed Tempo token contracts/fee eligibility, fresh mainnet price sources, and unpaid USDC.e/pathUSD seller offers. This does not establish funded end-to-end settlement.

Still pending:

- Owner will perform live mainnet execution/paid-API verification. Deployment and funded live tests of the expanded Tempo token/fee matrix remain pending. No mainnet spending is authorized for the assistant. Unit checks, local wallet/policy checks, isolated mainnet/testnet accounting and MCP/OAuth checks pass; no browser checks run.
- Plugins remain pinned to their existing testnets and their implementations were not changed. Mainnet ENS sends require recipient addresses; mainnet plugin support is not part of this work.
- ENS agent-signed record update and payment-to-name live verification.
- Additional live scheduled/funding Uniswap execution.
- Automatic release for provably unused expired Tempo/Solana payments and stronger unknown-submission recovery.
- Rate limits, pagination, webhooks and operator recovery tooling.
- Owner-deferred fiat funding: treat onramp/offramp as owner-only core wallet flows, not plugins. Privy + Meld/Onramp Money is the leading India/INR onramp candidate, but requires Meld KYB, a Privy React SDK upgrade and live regional verification; real providers fund mainnets, so do not silently target testnet wallet counterparts. Offramp remains later because Privy/Bridge does not document INR payout rails.
- User TODO: Muse plugin and ChatGPT plugin. Track as future work, not authorization to implement; ChatGPT's existing custom MCP connection is already verified.
- Owner-selected next integrations after Tempo hardening/mainnet validation: AgentCard and Mercator. Not started; inspect exact integration/custody/credential contracts before implementation.
- Owner-tracked product TODOs, not approved implementation yet: Monid plugin (inspect its exact x402/MPP contracts first); possible Meta Muse integration (official material establishes Link’s wallet for agents is built into Muse, but not a public Muse connector platform); and a product/architecture decision between AgentCard and Link agent payments. Determine each option’s exact custody, approval, credential-handling, availability and integration contracts before deciding whether it is a core payment rail or an optional plugin. Link Financial Insights is a separate optional data integration, not part of payment core, and remains deferred.
- Owner-tracked paid API/data-product candidates, exploratory only: (1) an agent-commerce capability detector and searchable index for MCP, OpenAPI, `llms.txt`, UCP, x402, MPP, authentication, networks/assets and live endpoint status; (2) a country-specific live-sports viewing availability database with official broadcaster/streaming links, language, price and replay information; and (3) a game-availability database covering storefronts, regional pricing, platforms, subscription catalogs, cloud gaming, cross-play/cross-save and delistings, potentially paired with a consumer discovery/backlog product. Prefer a useful public website plus developer API and optional MPP/x402 access; research data acquisition, legality, freshness, demand and maintenance cost before choosing one.

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
- `testing/`: focused checks and protocol fixtures. `bun run check:offline` runs the explicit offline regression suite; database-backed and live-provider checks remain separate.

## Local runtime and validation

- Dashboard `3000`, API `3001`, Postgres `127.0.0.1:55432` under Compose project `agentis-rewrite`.
- Start backend processes from `apps/backend` so its private environment loads.
- Core/SDK/MCP exports resolve to `dist`; run `bun run build:packages` after contract changes.
- Standard validation: `bun run check` for builds/types and `bun run check:offline` for curated regressions. Offline checks use disposable wallet fixtures and mocked/loopback HTTP, not private credentials or funded wallets. Use narrower checks for small changes; never blindly execute all testing scripts.
- Do not restart execution against a stale local database snapshot.
- No browser verification unless explicitly authorized.

Existing test agent: `research-agent` (`3068f575-d2d1-4ac8-a737-25841fef7fae`), ask mode. Do not create agents, move funds or alter unrelated paused states without consent.

## Sensitive and unrelated local state

Private: root/backend environment files, `.agentis-test-keys/`, `data/key-secrets.json`, CLI/wallet files, authorization keys and RPC credentials. `privy-server-authorization.key` is a P-256 authorization key, not a wallet private key.

Preserve unrelated dirty paths, including `apps/docs/next-env.d.ts`, `testing/x402-server/index.ts`, `apps/next-app/AGENTS.md 04-33-15-918.md` and `testing/umbra-test/AGENTS.md` if present. Never blanket reset or clean the worktree.

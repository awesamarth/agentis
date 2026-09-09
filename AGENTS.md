# Agentis — Living Handoff

Last updated: 2026-09-08. Read this first after a context reset.
Update after each meaningful milestone: decisions, changes, checks, blockers, next step.
Keep it concise; replace stale status rather than accumulating transcript/history dumps.
**Decided is not implemented.** Record evidence before marking work done.

## Current checkpoint

**Rename fix:** Name-only saves (including retries) no longer invoke Privy setup, modify wallet policies or invalidate pending approvals. Explicit unchanged-settings setup is separate from rename. Removed the two requested review paragraphs. Existing integration check covers rename retry isolation; 14 backend tests pass, targeted UI lint passes. API restarted as PID 31783; worker remains 30816. Original provider setup error was not captured; fixing the rename path does not establish that live ownership migration succeeds.

**2026-09-09 — Owner-approved hosted authority correction (supersedes user-signature/per-provider automation requirements below):** Use a 1-of-2 owner quorum (authenticated user + Agentis server authorization key). Auto mode checks user limits then backend authorizes Privy signing; ask mode uses an owner-only approval button, not a user wallet-signature prompt. Implemented in local runtime, with per-agent caps/recipient/pause checks, USD budget recheck before signing, existing reservation/idempotency/reconciliation retained. New-wallet provisioning creates this quorum; existing wallets migrate only on explicit Edit rules → Save using Privy SDK `user_jwts` authorization. Replace the target wallet’s owner; never mutate a possibly shared user quorum. Strict inspector accepts only sole user or exact user+configured-server quorum; executor requires the latter, with no signer fallback. Migration 0005 adds verified `serverAuthorized` state. Local server P-256 authorization key created at `.agentis-test-keys/privy-server-authorization.key` (0600), referenced by backend `.env`; no existing keys rotated/imported/exported. API/worker PIDs 30815/30816 healthy. Updated existing tests: 14 backend tests pass; backend/frontend typechecks and frontend lint pass. Actual logged-in migration and new live transfer still need manual proof; no user wallet ownership changed by an unattended probe. Export rights are supported by the topology/SDK; export UI/endpoint not implemented in this slice. Scope remains dashboard + backend, no unrelated expansion.

**2026-09-09 — Active scope: dashboard + backend consolidation only.** Owner clarified multiple named agents with independent wallets and rules are core; do not replace these with one account-wide budget. Implemented `/v1/agents` create/list/edit, agent-scoped Privy wallet provisioning, per-payment/hourly/daily/total USD caps (including fees; rolling windows; blank/null means no cap), pause and recipient rules. SDK thin methods and dashboard agent cards/editor/wallet selector wired; logged-in guest section hidden. Migration `0004_independent_agents` applied locally, grouping existing hosted wallets without re-provisioning. Before/after DB comparison confirmed wallet IDs, addresses, provider IDs, policies and enabled states unchanged. Agent edits invalidate only that agent’s unsubmitted approvals. Existing atomic wallet restrictions remain additional constraints. Old singleton onboarding POST removed; GET remains network metadata. Legacy owner USD accounting remains only for ungrouped wallets; agent wallets use their own budgets. One existing integration test replaced to cover multi-agent isolation, idempotent creation, four limits, and wallet preservation; 14 backend tests pass, backend/frontend typechecks and dashboard lint pass. API/worker restarted as PIDs 24037/24038; health and dashboard HTTP 200. Logged-in owner browser E2E still needs manual validation. No new live transfer, deployment or mainnet action. Do not expand CLI/MCP/plugins until this slice is accepted. Guest policy restoration and multichain guest support remain outstanding, not fixed by hosted-agent work.

**Hosted implementation in progress; requested scope through onboarding is NOT complete.** Testnet-only Privy signing, owner request-signature approvals, token-aware reservations, network settings, Back/Next/Finish onboarding and an asset-aware payment form are implemented. Base ETH/USDC, Arc USDC and Tempo type-118 alphaUSD transfers have confirmed using isolated authorization-key-owned Privy wallets; this is NOT a logged-in browser-user E2E proof. Solana devnet SOL and SPL USDC transfers now confirmed through the operation/approval/Privy SDK signing/receipt pipeline. Owner explicitly approved funding from `SOLANA_DEV_WALLET_KEY`: CLI sent 0.01 SOL + 1 USDC from `5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6` to isolated Privy wallet `4Wo6hbyPVLXniTH7ZiU8yg56MgbbqWUisjtJ8T5G3NS5`. No key import into Privy; temporary 0600 CLI key file removed. Other existing funded wallets untouched.
Privy 0.34.0 **does provide `wallets().transfer()` for SOL/SPL/devnet**. Live probe: app-only action rejected 401; funded Base transfer Intent created pending and explicitly rejected. After funding, Solana transfer Intent also created pending and was explicitly rejected; no owner authorization supplied for that separate Intent probe. Do not describe this as absent SDK support. Higher-level action integration still needs bounded network fees and action/Intent reconciliation; inspected transfer DTO has cross-chain BPS fees, not an absolute network-fee cap. Capped SDK transaction path remains; hand-written Privy HTTP signing was replaced with `wallets().rpc()` and supplied owner signatures only. Latest actual Base proof: `0xd8bd2c7384720d7e006c492e2b7987695d01c2aab057e81c8e0f7c5e378e292b`. Solana SOL tx `3M6AVJwPUMeEBpXeQ3WXQDPG1jPeTL9DWtYxY1Z3RNf7xYAaZM1n6g4xdxGMSkdJej6YsRo3d4GFTaq7rwAGzYUP`; USDC tx `xeSfcWND1XZy2SmAWyMqLjUuUnBNNTQEzxgDQnYrBbQF5qvwkgdy5hWHFr7ccBAr5XDKK7PKjvvwPNybNvC6ELN`. CLI independently verifies recipient `BS4wEey9bhuk2dmKwnfNTjh9MXb5QU9KMASEdt8ZvpR3` received 0.001 SOL + 0.01 USDC. Re-running USDC proof returned the same operation/hash without another payment. Source retains 0.00750156 SOL + 0.99 USDC. Funding/proof scripts typecheck; no new unit tests added for these manual probes.
Core x402/MPP consumption, provider-enforced automation and remote OAuth remain unavailable; the new bounded/DNS-pinned HTTP transport is tested but not a working payment integration. Plugins mean user-enabled integrations (Jupiter/Umbra), not chains/internal modules. Build order: Base, core paid requests, Arc/Tempo, Solana, network onboarding alongside; Jupiter/Umbra afterward.
Checks: **32 tests / 136 assertions** after removing two dependency-only Privy tests, the constant-503 stub test and CLI help-output test; financial/security regressions retained. `bun run test` passes; package builds and all application typechecks pass; dashboard lint passes. Latest production browser build/E2E not rerun. Local services restarted after laptop shutdown: Docker/Postgres healthy on 55432; API PID 13287 and worker PID 13290 with Privy executor; dashboard launcher PID 13292 on port 3000. API health and dashboard HTTP 200 verified. No deploy, publish, mainnet writes, private-key import or credential rotation.

## Product and positioning

SDK-first financial execution platform for agents: give an agent financial capabilities without making developers build wallet, permission, approval, payment and receipt plumbing.
Sell the complete developer/user experience, not a wallet wrapper or chain-count checklist.
Privy supplies underlying wallet/control primitives; Agentis connects agent requests to user authority, execution and accounting.
Approvals/policies are necessary architecture, not an established moat. Differentiation hypothesis: dramatically easier integration and a coherent experience across financial providers.

- Human controls wallet access, permitted actions, budgets, approvals and revocation.
- Agent credentials cannot change their own permissions or approve themselves.
- Modes: ask every time (default), bounded automation, paused. Specify recovery/cancellation behavior explicitly.
- Multichain: **Base is the product default/primary EVM chain** (Base Batches application); Tempo is another priority. Ethereum and Solana supported in direction; Arc for meaningful ETHOnline integration/demo after rewiring.
- EVM compatibility is not feature parity: chain/asset/gas/policy/funding capabilities must be explicit.

## Agreed scope

| Area | Decision |
| --- | --- |
| Hosted wallets | Privy-first; reuse wallet actions, signers, policies, intents where supported |
| SDK | Main developer interface; thin TypeScript HTTP client, no mandatory viem/Privy dependency for consumers |
| CLI/MCP/dashboard | Thin interfaces to the same backend operations |
| x402/MPP | First-class core capabilities, not optional plugins; paid API consumption through the common authorization/execution path. Current `paidFetch` plugin flag is a temporary unavailable placeholder to remove during implementation. |
| Jupiter/Umbra | Optional first-party plugins, not core product logic |
| Link | Secondary payment integration, not primary rail or prerequisite for rewrite |
| Funding | Reuse supported Privy/onramp integrations; verify chain/asset/geography coverage |
| Local wallets | Trusted-device mode; filesystem permissions acceptable; correct derivation and honest security claims |
| Facilitator | **Remove completely**: commands, templates/Kora wiring, routes, records, docs and dedicated tests; this does not mean removing x402 consumption |
| Guest wallets | **Keep localStorage private-key flow** for quick tryout; clearly labeled testnet-only browser demo, separate from hosted security guarantees |
| Quasar | Remove obsolete enforcement wiring from core |
| ERC-8004 | Deferred optional public-identity integration; no marketplace/reputation/validation engine |
| Hosted bot | Later, small reference app/demo; not a general-purpose hosted agent product |

No compatibility shims, custom Solidity/AA infrastructure, microservices, or plugin marketplace without a concrete need.
Deleting implementation does not authorize destroying secrets, funded wallets, remote services or moving real funds.

## Chosen stack

- Bun + Hono; Postgres + Drizzle with SQL migrations; Zod at trust boundaries.
- EVM: **viem**, not ethers/web3.js. Use `parseUnits`/`formatUnits`, ABI helpers, simulation and receipt tooling.
- Atomic amounts: `bigint` internally, decimal strings across JSON boundaries; explicit chain IDs and chain-qualified assets. No floating-point token arithmetic.
- Privy current supported SDK: higher-level wallet actions first, low-level transaction RPC only when needed. Verify actual available APIs before implementation.
- Solana: prefer Privy actions; for owned Solana code target pinned **@solana/web3.js v3** after compatibility verification. Research currently identifies v3 as RC, rebuilt by Blueshift/Solana Foundation on Kit internals. Check current release status; isolate unavoidable legacy/Kit conversions inside adapters.
- Next.js + Privy React SDK + TanStack Query. Wagmi only if external-wallet requirements justify it.
- One modular backend, one small worker sharing its codebase, one database. No Redis/BullMQ/Kafka initially.
- Foundry/Anvil/Chisel already installed; use if needed, no custom contracts just to use the tools.

## Execution and security contract

```text
SDK / CLI / MCP / dashboard / bot
  -> authenticate + resource-scoped authority
  -> build concrete operation through chain adapter/plugin
  -> validate actual transaction + policy + atomic budget reservation
  -> deny / pending human approval / automatic authorization
  -> authorized provider execution
  -> confirmation or reconciliation -> ledger + receipt + notification
```

- All hosted money paths use this pipeline. Plugins build actions/interpret results; they get no unrestricted signer or policy-admin authority. Start with explicit modules and validated config, not a general plugin framework.
- Separate wallet owner/admin from restricted executor; do not fall back to a stronger signer after denial. Avoid arbitrary signing tools exposed to agents.
- One user-facing policy model. Map supported constraints to Privy enforcement, implement missing cross-provider/network semantics centrally. Verify signer override composition rather than assuming all policies combine.
- Validate calldata/instructions, transfers, approvals, recipient, asset, network and fees—not just native transaction value or plugin-provided prose.
- Approval binds concrete action/constraints, expires, is consumed once, and is revalidated before execution. Material changes need new approval. No broadcastable transaction released before approval.
- Prefer genuine user authorization via Privy Intents where supported; a UI boolean plus an unrestricted backend key is not independent user control.
- Transactional operation IDs, idempotency keys, budget reservations and one-time grants. Unknown submission outcome means reconcile, not blindly resend. Provider signing/submission status is not necessarily chain settlement.
- Ledger records network, asset/decimals, exact amount, action/direction, status and provider/chain references. Never trust caller-supplied spend history.
- Paid fetch must validate actual payment terms and destinations/redirects, bound time/body sizes, preserve methods/bodies, and record payments independently of final HTTP success.
- SDK returns operation/status and approval URL when needed; polling/webhooks and receipts follow. Pending approval is not a hanging HTTP call or an error.
- Local wallets: same-OS-user access to key files can bypass software policy. Do not claim remote/Privy-level enforcement for local signing or retain empty-password encryption as a security selling point.

## Next work (in order)

1. Verify real Privy user-owner/signature/Intents topology on testnet. Implement provider-enforced approval/policy projection, not boolean authorization plus unrestricted signing. SDK lacks the inspected authorize helper; documented REST may be used once actual user signature format/access is verified.
2. Integrate Base testnet token execution and funding/onboarding; define token-aware accounting (current budgets are native atomic units per wallet including fees, not USD). Add browser E2E and operator handling for permanently unknown submissions.
3. Restore x402/MPP consumption and Jupiter/Umbra behind the common operation boundary, with bound payment terms and explicit capability tests. Implement scoped remote OAuth; current remote MCP returns 503.
4. Only then Arc hackathon flow, Tempo/remaining providers and demo: approved USDC payment, bounded automation, over-budget denial, safe retry and receipt. Link secondary. Webhooks/pagination/rate limits remain outstanding.

### Open / needs verification

- Concrete Privy user-owner + automation-signer + approval topology and our app's Intents/API access. Intents API is distinct from Enterprise-only Privy Dashboard manual approvals.
- Policy/accounting semantics: cross-chain USD valuation, fees, reservations/expiry, recoveries, external recurring orders. Existing kill switch cannot undo already-issued authority/transactions.
- Exact network/provider feature matrix: Arc uses native USDC gas; Tempo has special transaction/fee handling. Wallet support does not imply onramp or protocol support.
- Base Batches published positioning permits multichain with Base default; verify application agreement. Arc has explicit ETHOnline continuity prizes; **Privy continuity eligibility unconfirmed**—ask organizers.
- Bot hosting economics: constrained tools/model, per-user quotas and global inference spend ceiling; invite-only/testnet first. No shared account key or general shell. Public chat needs authenticated per-user linking and isolated grants. BYOK/installable example are options.
- No subagents unless owner explicitly changes that instruction.
- Overnight execution is local/testnet only: mocks/Anvil first, testnets where credentials/funds permit. Architecture supports explicit mainnet configuration, but no mainnet transactions, deposits, swaps or paid requests; leave existing mainnet balances untouched.

## Historical audit baseline — old paths removed, not restored feature parity

Review covered principal backend, SDK, CLI/local wallet, MCP/OAuth, dashboard, Quasar and facilitator paths. Not exhaustive; no production exploitation or funds moved.

- `apps/backend/src/routes/sdk.ts`: agent key can rewrite its own policy; paid-fetch handlers sign/pay without backend policy enforcement; `mint` affects valuation but send always constructs native SOL transfer; record-spend trusts caller data.
- `routes/agents.ts`: account/MCP paid fetch skips policy and omits amount needed for recording; generic updates bypass dedicated policy scope; `wallets:write` can regenerate powerful agent keys. Earn lacks common spending checks.
- `routes/umbra.ts`: value-moving paths lack common policy/history enforcement.
- `lib/db.ts`: whole-file read/modify/write races. Isolated temporary DB reproduction: **8 successful concurrent transaction writes retained 1 record; one OAuth code consumed concurrently 8/8 times**. Refresh queue only covers refresh; prior access tokens capped at eight.
- `packages/core/src/policy.ts`: NaN accepted, malformed URLs fail open, negative history reduces spend. Backend policy JSON insufficiently validated.
- `packages/sdk/src/payment.ts` / `client.ts`: blanket six-decimal x402 conversion, MPP units treated as USD, unsafe pricing fallback, stale local policy/history, checked terms not bound to executed terms.
- `lib/jupiter.ts`: omitted slippage can evade configured cap, fuzzy token fallback can choose wrong asset, missing policy returns zero USD valuation.
- Ledger mixes networks/assets and treats withdrawals as spending; lacks durable operation lifecycle/reservation/idempotency/reconciliation. Paid fetch exposes SSRF/resource-exhaustion surface.
- Quasar is an optional counter/check instruction, not custody-enforced spending; caller supplies timestamp/USD amount; owner equals agent; limit/window semantics differ from backend.
- Local wallet uses secp256k1 BIP32 derivation for Ed25519 keys and empty encryption passphrase; guest wallets put private keys in localStorage.
- Facilitator does not bind requirements to transaction in wrapper; fee race, no unique settlement signature, default seller balance reset. Delete rather than harden.

Baseline checks run during review:
- `bun test packages/sdk/src/*.test.ts packages/mcp/src/*.test.ts packages/cli/src/command-validation.test.ts apps/backend/src/lib/*.test.ts`: selected existing eight files, **25 passed**. Passing tests did not cover the above races/bypasses.
- Backend `tsc --noEmit --incremental false -p apps/backend/tsconfig.json`: fails `sdk.ts` missing `BodyInit`.
- Dashboard equivalent typecheck passes; `cd apps/next-app && bun run lint`: **23 errors, 13 warnings**.
- Pure-function probes confirmed NaN/domain/history issues and 1 wSOL parsed as 1,000 token units. Race probes used temporary files, removed afterward; not committed regression tests yet.

## Repo / operating notes

- **Owner instruction: commit completed meaningful changes as work progresses.** Do not leave milestones uncommitted. This first checkpoint records the current incomplete rewrite as-is, not feature completion. Use real timestamps; no history reconstruction, push or deployment without approval.

- Layout: `apps/backend/src/{app,operations,runtime,worker}.ts`, `src/db`, `src/providers`; `apps/next-app`, `apps/docs`; `packages/core`, `sdk`, `cli`, `mcp`; `testing/*`. Quasar tracked sources removed; ignored local build artifacts/keys preserved.
- Use **bun / bun x**, never `bunx` (unreliable here). Backend: `cd apps/backend && bun run index.ts` for its `.env`; dashboard: `cd apps/next-app && bun dev`; CLI: `cd packages/cli && bun src/index.ts`.
- Ports: dashboard 3000, backend 3001, **rewrite Postgres 127.0.0.1:55432**, x402 fixture 4000, MPP fixture 4001. Compose project `agentis-rewrite` was started locally; leave existing JSON data untouched. Explicit migrations only. `bun run check`, `bun run test` build before checking; core/SDK exports point to **dist**. Stale workspace node_modules symlinks initially resolved old SDKs; cleaned dependency directories and reinstalled root successfully.
- Pre-existing dirty work when handoff rewritten: `AGENTS.md`, `testing/x402-server/index.ts`, untracked `apps/next-app/AGENTS.md 04-33-15-918.md`, `testing/umbra-test/AGENTS.md`. Preserve unrelated owner edits; never blanket reset/clean.
- Secrets: root `.env` historically contains a raw Cloudflare token (not KEY=value). Never print it. Backend `.env`, `data/key-secrets.json`, `.agentis-test-keys/` and local wallet/keychain files are sensitive. RPC URLs can contain keys. Use temporary test data; never run destructive tests against live DB/wallets.
- Historical deployments (not reverified this review): dashboard `https://agentis.systems`, API `https://api.agentis.systems`, docs `https://docs.agentis.systems`, MCP `https://mcp.agentis.systems/mcp`. Railway backend auto-deploys from configured branch; Vercel dashboard/docs; separate MCP Worker deploy from `packages/mcp`. Do not deploy/publish/rotate credentials or spend mainnet funds without approval.
- Historical published versions: CLI 0.4.1, MCP 0.2.1. MCP introspection secrets must match Railway/Worker. Existing auth: Privy JWT, `agt_user_` account keys, `agt_live_` agent keys, OAuth access/refresh bundles. These are legacy facts, not constraints on redesign.
- Hermes historical private demo: Railway `hermes`, persistent `/opt/data`, SSH `agentis-hermes`; environment account key. Do not restart local Telegram polling (same bot token), alter home channel, or treat this as a public multi-user bot. Mac sessions/config are separate from Railway even with SSH terminal execution.
- `leno` is an existing funded test wallet; no casual mutations or spends. No users does not mean all balances are disposable.

## Integration knowledge / research pointers

- Privy: https://docs.privy.io — prioritize `/wallets/actions/transfer/overview`, `/transaction-management/intents/overview`, `/recipes/wallets/conditional-signer-policies`, `/controls/policies/stateful-policies`. Research: stateful aggregations documented for EVM transaction/user-op signing, rolling 1–72h; not universal cross-chain USD accounting. Recheck current support.
- Link: https://github.com/stripe/link-cli; reviewed clone `/tmp/agentis-link-review.fCwoHD/link-cli` is disposable and may disappear. Spend-request/approval lifecycle worth reusing; README currently US-only and asks native consumer integrators to contact Stripe. Never share a CLI login across users.
- Solana v3: https://github.com/solana-foundation/solana-web3.js/tree/v3.x. EVM: https://viem.sh. Prizes: https://ethglobal.com/events/ethonline2026/prizes.
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004 (Draft at review). Identity/discovery is not authorization; NFT transfers must not transfer Agentis financial grants. Deferred.
- Large local docs: search `reference-dumps/{JUPITER,umbra,x402,mpp}.txt`, don't load whole dumps. Current provider docs/installed types outrank old notes.
- Preserve payment fixtures/conformance knowledge: x402 v2 `PAYMENT-REQUIRED`, v1 body; MPP `WWW-Authenticate: Payment ...`; preserve method/body/binary responses. Existing Privy protocol clients are preferable to handcrafted signatures, but need central authorization.
- Umbra legacy RC6 (`@umbra-privacy/sdk@5.0.0-rc.6`): native scanning, encrypted-balance-sourced UTXOs, skip already-burned notes; Node prover subprocess due Bun worker incompatibility; polling monitors. Inspect current exports/examples before plugin migration. Encrypted balance alone hides amount, not linkability.
- Jupiter legacy flows include swap/portfolio/recurring/Earn deposit+withdraw on mainnet; keep protocol knowledge, not route architecture. Recurring quirks: `includeFailedTx=false`, orders under `time`, numeric `inAmount`. Verify current APIs.

## Decision / progress diary

- **2026-09-08 — Audit:** reviewed prototype without subagents or live writes; confirmed security/accounting gaps and recorded baseline checks above.
- **2026-09-08 — Direction locked:** owner wants clean-slate rewrite despite no users, for ETHOnline and Base Batches. Foundation before Arc; Base-first + Tempo priority; SDK-first; Privy reuse; viem/Postgres/Drizzle stack approved. Facilitator fully removed in target; Jupiter/Umbra plugins; Link secondary; ERC-8004 deferred.
- **2026-09-08 — Handoff reset:** condensed old deployment diary; owner subsequently authorized implementation.
- **2026-09-08 — Owner correction:** preserve guest private keys in localStorage for quick testnet tryout; local/testnet-only execution. No subagents, mainnet actions, Arc rollout or deployments.
- **2026-09-08 — Foundation built:** dedicated local Postgres 17 + two Drizzle migrations; strict contracts, owner/grant authority, hash-bound approval/expiry, transactional reservation/idempotency, persist-before-broadcast worker, unknown-outcome reconciliation and signed-byte redaction. Native budgets include max fees; app-level Anvil approval only.
- **2026-09-08 — Interfaces/removal:** thin SDK, operation CLI/MCP, dashboard access/review, guest devnet preserved; correct SLIP-0010 local Ed25519 wallets and web3.js 3.0.0-rc.3 async key APIs. Old backend/CLI/Quasar/facilitator paths removed. Plugin config fails closed; remote Worker paused. README/docs/skill rewritten to distinguish unavailable features.
- **2026-09-08 — Evidence:** `bun run check` passes; unit/interface tests 16 pass/42 assertions; isolated Postgres/Anvil integration 10 pass/41 assertions (concurrency, budget safety, no self-approval/escalation, cross-tenant denial, binding/expiry/revocation, unknown outcomes, real local signed transfer). Dashboard eslint passes; production Next build passes after one timed-out attempt. Privy JWT/ownership paths typechecked, not exercised against live app. Docs production build and MCP Worker dry-run build pass; runnable `examples/operation.ts` typechecks (not separately executed; actual local transfer is covered by integration tests). Seller-only SDK dependencies are optional peers, keeping the main client free of mandatory chain libraries. Root diff whitespace check passes. Changes remain uncommitted.

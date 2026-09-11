# Agentis — Project Notes

Keep this a current snapshot, not a diary. Replace stale notes; history belongs in Git. Decisions and implemented behavior are not the same.

## Working agreement

- **Current scope: dashboard + backend consolidation.** Follow the owner's next small request; do not expand into another rewrite, integrations or tooling without direction.
- Make simple, focused changes. Preserve the existing beige/black UI and compact controls; prefer Tailwind and installed dependencies.
- **Commit meaningful changes locally. Never push.** Pushing may trigger Railway deployment. No backdating, publishing or deployments.
- No subagents. No web research when the owner prohibits it; inspect local code/types first.
- Validate proportionately: targeted lint/typecheck or a relevant existing check for small changes. Add a focused regression check for meaningful money/security logic; do not grow suites for copy, styling or dependency behavior. Full builds/suites only when the change warrants them.
- Report what actually works and what remains unverified. Do not substitute passing tests for a usable authenticated flow.

## Product and decisions

SDK-first financial execution for agents: wallets, permissions, budgets, approvals, payments and receipts through one backend. **Multiple named agents, each with independent wallets and rules**—not one account-wide wallet or budget.

- Base is the default EVM network; Tempo is a priority. Arc and Solana are supported in current testnet adapters. Mainnet is the product target, **not authorized for current execution**.
- Each agent has per-transaction/hourly/daily/total USD caps shared across its networks, including fees. Hourly/daily windows roll; total does not reset. Blank/null means no cap; zero blocks spending. Legacy atomic wallet restrictions remain additional constraints.
- Modes: `ask` (default owner approval button), `automatic` (within limits), `paused`. No per-payment user wallet-signature prompt.
- Privy holds wallet keys. New hosted wallets use a **1-of-2 owner quorum: user + server authorization key**. Either owner can administer/export; this is backend-enforced policy, not independent provider-enforced spending control. Restricted agent credentials cannot approve themselves, change rules or export keys.
- SDK/CLI/MCP/dashboard are thin interfaces to common operations. x402/MPP consumption is core; Jupiter/Umbra are optional integrations, not chains. Link is secondary; ERC-8004 and hosted bot are deferred.
- Preserve the testnet guest localStorage private-key flow (`agentis_guest_agents`). Guest policies and multichain support still need restoration. Do not claim hosted security for guest/local wallets.
- Facilitator and obsolete Quasar enforcement were removed; do not restore them. No speculative compatibility layers, contracts or microservices.

## Current state and next work

- Automated suites and root test commands were removed at the owner's request. Standalone `/test` compares native Privy wallets, backend-created throwaway quorum wallets (no Agentis DB rows), and JWT REST/token diagnostics. Native export and explicit server-member quorum export were user-confirmed; both customer and internal Privy tokens failed the user-key exchange. Existing test-agent records were not deleted; do not claim authenticated functionality from old automated results.

- Hosted operation pipeline, per-agent CRUD/budgets, network setup, transfer form and approval button are implemented. Name-only saves are metadata-only and must not invoke Privy setup or invalidate approvals. Rules saves reuse verified `serverAuthorized` state without Privy setup calls; unconfigured wallets still require setup, and payment execution rechecks ownership.
- Setup modal: stable viewport-capped height, scrollable content, backdrop dismissal except while saving, direct step navigation and Save on every step when editing or after reaching Review during creation. Saving revalidates the current inputs. Labels use “Per transaction” and “Testnet”; payment reason is optional. Dashboard dropdowns share `Dropdown.tsx` (Radix Select): light beige options matching the fields, black highlight, padded chevrons and dialog-safe portals.
- Profile is now `/profile`; `/dashboard/profile` was removed, with no redirect. V1-style identity, overview and spend analytics use owner-scoped backend aggregates (all settled records, UTC daily buckets, fees included). API access lives on `/dashboard/agents/[id]`, not profile: keys have no expiry by default (valid until revoked; optional explicit expiries have no 30-day cap) and default to all of that agent’s enabled networks (including future additions), with an optional multi-network allowlist (non-empty, selected enabled networks only) and copy/revoke controls. Existing wallet-scoped keys retain their scope. Scoped keys can list only their enabled wallets; execution rechecks scope. Account-wide keys remain unavailable. Authenticated profile interaction is unverified.
- **Existing-wallet migration remains broken/unexplained:** Privy rejects the SDK `user_jwts` exchange with `400 Invalid JWT token provided`, despite a fresh ES256 token, matching audience and successful Agentis authentication. Re-login did not fix it. Do not guess expiry or claim migration works.
- Owner requested removal of old `test-agent-1` (`ce77f477-75e3-46e4-a752-d74703a68c04`). Local agent row removed; four wallet records retained disabled/detached and grants revoked. Privy keys/funds untouched. Recovery metadata: `.agentis-test-keys/removed-agent-<id>.json`. Removing this agent avoided the failing migration, **not fixed it**.
- New wallets are provisioned directly with the quorum. Actual authenticated provisioning and both payment modes still need end-to-end confirmation. Earlier isolated Privy transfers confirmed Base ETH/USDC, Arc USDC, Tempo alphaUSD and Solana SOL/USDC; those do not prove the current browser-user flow.
- Agent detail has a black Settings button (shared modal), a red confirmed Pause action, and a separate export danger zone. Pause updates all agent wallets under the owner lock without Privy setup, denies unsubmitted approvals and preserves submitted reconciliation. Export requires explicit confirmation, owner authentication and live Privy ownership inspection, and now explicitly uses the verified server quorum member by owner request (not a fallback). Keys are not cached/stored and are hidden on dialog close/tab switch. Server-member export worked on the throwaway wallet; normal agent-page export still needs user confirmation. User-JWT exchange remains unresolved and isolated to diagnostics/migration. A separate fresh-login/step-up challenge is not implemented.
- Guest regressions, x402/MPP consumption, Jupiter/Umbra and remote OAuth remain outstanding. Remote MCP is unavailable. Webhooks, pagination, rate limits and permanently unknown-submission handling remain follow-up work.
- Hosted dashboard cards show only the consolidated total labelled “Balance in USD”; the click/keyboard-expandable chain/token breakdown is available only inside the agent detail page. Owner-only `/v1/agents/:id/balance` reads enabled wallets and supported assets via existing chain RPC clients. Base display reads use Viem `multicall`: Multicall3 `getEthBalance` + USDC `balanceOf` return both balances in one `eth_call` at the same block (live-checked). Arc/Tempo retain single reads; payment execution is unchanged. Unknown balances/prices stay unavailable or partial, never silently zero. Uses bigint valuation with existing price sources, separate from spending budgets; refreshes every minute and on demand. All four testnet balance reads were checked locally; authenticated browser interaction remains unverified. Guest wallet UI is unchanged.
- **Next: follow requested dashboard/backend fixes, then confirm the real user flow.** Do not jump to integrations before this slice is accepted. Latest modal change passed dashboard typecheck and targeted lint; browser interaction was not rerun.

## Money and authorization invariants

`authenticate → concrete action → policy + atomic reservation → approval/automatic authorization → Privy execution → reconcile → ledger/receipt`

- Validate actual recipient, network, asset, calldata/instructions, amount and maximum fees. Use bigint atomic amounts and decimal strings across JSON; never floating-point token arithmetic or caller-reported spend.
- USD accounting uses fresh server prices, fails closed on missing/stale quotes, reserves amount + max fees and rechecks before signing. Settlement uses execution prices and actual fees; failed transfers charge fees only.
- Preserve agent- or wallet-scoped grants, transactional idempotency/reservations, owner locking, expiring hash-bound one-time approvals and execution-time revalidation. Agent changes affect only that agent's unsubmitted approvals.
- Persist signed bytes/hash before broadcast, never expose signed bytes to callers. Unknown submission means reconcile and retain reservations—not blind resend. A provider response is not chain settlement; pausing cannot undo issued transactions.
- Inspect exact expected Privy ownership; never fall back to a stronger signer after denial. Existing-wallet ownership changes require explicit owner-authorized setup, preserve addresses and must not mutate a shared quorum.
- Future paid fetch must bind actual payment terms and recipients, enforce SSRF/redirect/time/body bounds and preserve method/body/binary responses. Record payment even if the final HTTP request fails.

## Stack and local operations

- Bun/Hono, Postgres/Drizzle with explicit SQL migrations, Zod; Next.js/Privy React/TanStack Query; viem for EVM. Solana uses pinned web3.js v3 RC with adapter-local conversions. One backend, worker and database.
- Use **bun / bun x**, not bunx. Core/SDK exports resolve to `dist`: run `bun run build:packages` after changing their contracts.
- Backend: `apps/backend/src/{app,operations,runtime,worker}.ts`, `modules/{onboarding,usd-budget}.ts`, `providers/{privy,privy-executor}.ts`, `db/`. UI: `apps/next-app/components/`. Thin interfaces: `packages/{core,sdk,cli,mcp}`.
- Start API/worker from `apps/backend` so its `.env` loads; dashboard from `apps/next-app` with `bun dev`. Privy runtime uses `AGENTIS_EXECUTOR=privy`, `AGENTIS_PLUGINS='{}'`, `DASHBOARD_URL=http://localhost:3000` and the dedicated local `DATABASE_URL`.
- Ports: dashboard 3000, API 3001, **Postgres 127.0.0.1:55432** (Compose project `agentis-rewrite`, database `agentis_dev`), x402 fixture 4000, MPP fixture 4001. Migrations through `0008_optional_key_expiry.sql` applied locally. Check live processes/health; don't trust historical PIDs.
- Logs: `/tmp/agentis-{api,worker,dashboard}-local.log`. Never log raw tokens, keys or credential-bearing URLs.
- Privy 0.34.0 **supports `wallets().transfer()`**, including Solana devnet SOL/SPL. Current capped executor uses SDK `wallets().rpc()`; higher-level actions still need fee bounds/reconciliation. Inspect installed SDK types before declaring support absent. Search `reference-dumps/` selectively for deferred integrations.

## Safety and preservation

- Local/testnet only. No mainnet spending, credential rotation, private-key import into Privy or destruction of funded wallets without separate explicit approval. Existing funded `leno` and other balances are not disposable.
- Sensitive: root/backend `.env`, `data/key-secrets.json`, `.agentis-test-keys/`, wallet/keychain files and RPC URLs. Root `.env` historically includes a raw Cloudflare token—never print it. The 0600 `privy-server-authorization.key` is a P-256 authorization key, not a wallet private key; backend `.env` references it.
- Preserve unrelated dirty files; never blanket reset/clean. Known unrelated files: `apps/docs/next-env.d.ts`, `testing/x402-server/index.ts`, `apps/next-app/AGENTS.md 04-33-15-918.md`, `testing/umbra-test/AGENTS.md`.
- Leave legacy JSON data and remote services untouched. Do not restart local Telegram polling for the existing Railway Hermes bot or change its channel/configuration.

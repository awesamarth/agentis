# Rewrite architecture and local runbook

## Implemented boundary

`apps/backend/src/app.ts` is the only HTTP route tree. Legacy `/agents`, `/sdk`, `/account`, `/auth`, `/oauth`, `/umbra`, facilitator and Quasar routes are not mounted and their implementations were removed. No route can recover a legacy plaintext agent key to call a different handler.

`OperationService` owns authorization, transactionally reserved budgets, immutable operation bindings and state transitions. The same service is used by every new interface. SQL migrations live under `apps/backend/drizzle`; the old JSON files are neither read nor migrated.

`packages/core/src/operations.ts` supplies Zod contracts. The SDK is an HTTP client with type-only core imports. CLI/MCP/dashboard call that API, not providers. First-party plugin configuration is validated and defaults unavailable capabilities to false; enabling an unimplemented plugin is an error.

## Authority

- Owner: verified Privy access token. Can link a directly user-owned Privy EVM wallet, edit its policy, issue/revoke grants and review operations.
- Executor: opaque random `agt_exec_` token; only a SHA-256 hash is stored. Restricted to one wallet and the implemented transfer action; expires within 30 days. Cannot administer grants, modify policy, approve, or read another grant's operations.
- Wallet policy changes invalidate all unsubmitted operations atomically. Revocation invalidates that grant's unsubmitted operations. Already submitted transactions cannot be undone.
- Local-only exception: an explicit 32+ character `AGENTIS_LOCAL_OWNER_TOKEN`, accepted only in nonproduction Anvil mode as `local-demo`. Never use this as production authentication.
- MCP deliberately exposes only capability discovery, request/get/list operation tools, not approval/admin tools. Remote OAuth transport is disabled until separately reimplemented and tested.

## Operations and accounting

States: `pending_approval -> queued -> submitting -> submitted -> confirmed/failed`; `unknown` holds ambiguous submissions. `denied/rejected/expired` release unsubmitted reservations. Policy/expiry/grant validation repeats immediately before signing.

Idempotency is scoped to the requesting principal; using the same key with different terms returns 409. Wallet row locks serialize budget mutations and worker preparation across processes. A principal-scoped Postgres advisory lock also prevents cross-wallet idempotency races. Different agent grants share the wallet's limits.

Approval includes a hash of the normalized input and policy version. It is owner-only, exact-match, expiring and consumed once. No arbitrary transaction bytes are accepted from clients.

Native limits include maximum gas fees per wallet/chain. ERC-20 and SPL amounts have separate asset-specific limits and reservations; their fees still count against the native budget. Tempo fee budgets use 18-decimal protocol USD units, rounded upward to six-decimal alphaUSD fee-token units. Zero means zero; no implicit unlimited default. Daily means rolling 24h of settlement observations plus all unresolved reservations. Settled failures charge gas; successful receipts charge transfer value plus actual fee. No token price guesses, USD conversion or cross-chain global limits yet.

The history scan is currently O(n) under a wallet lock; use indexed SQL ledger aggregates when volume warrants it. Budget migration/FX semantics must be designed before adding cross-provider assets.

## Execution support: be precise

- `anvil`: local loopback only, chain ID 31337 verified, dedicated configured private key. viem builds/signs native transfers, enforces fee cap and refuses contract recipients. Signed bytes/hash persist before any broadcast. One unresolved submission blocks that wallet's nonce lane.
- Reconciliation checks receipt by known transaction hash. If submission/receipt outcome is unknown, the service does not create or automatically broadcast another transaction. Crash after persistence but before broadcast can therefore leave a reservation blocked; manual resolution tooling is still outstanding.
- `privy`: SDK 0.34.0 verifies JWTs and the wallet's owner key quorum (not `owner_id === user DID`). Human approval supplies a signature over the persisted, expiring request. SDK `wallets().rpc()` receives only that signature; app authority is not a fallback. Base Sepolia ETH/USDC, Arc USDC and native Tempo type-118 alphaUSD executions have confirmed with isolated key-owned hosted wallets. SOL and SPL USDC devnet transfers also confirmed through the operation pipeline: 0.001 SOL and 0.01 USDC, with recipient balances independently checked by CLI. Repeating the USDC request returned the same operation/transaction, without another payment.
- `wallets().transfer()` supports SOL/SPL/devnet and constructs transactions itself. Live Base and Solana transfer Intents were created pending and rejected; app-only transfer was denied 401. Higher-level actions are not yet wired into operation execution: absolute network-fee caps and asynchronous action reconciliation must be preserved before replacing the capped transaction path. The inspected transfer fee configuration bounds cross-chain BPS fees, not gas. Solana transaction serialization currently uses official Solana SDKs, not a custom wire format.
- Mainnet cannot execute. Hosted automatic mode remains disabled pending provider-enforced delegation; logged-in browser-user authorization and settlement are not yet E2E-verified.

### Privy verification still required

Current docs describe wallet actions and asynchronous Intents:
- https://docs.privy.io/wallets/actions/transfer/usage
- https://docs.privy.io/transaction-management/intents/overview
- https://docs.privy.io/api-reference/intents/authorize
- https://docs.privy.io/recipes/wallets/conditional-signer-policies
- https://docs.privy.io/controls/policies/stateful-policies

Installed 0.34.0 exposes intent create/get and wallet actions; the documented `/intents/:id/authorize` REST signature flow is not exposed as an authorize helper in the inspected Intents class. REST is a valid future implementation option, not permission to invent the signature format. Verify user signature collection, required owner/signer topology, policy ownership, expiration, cancellation and actual settlement on testnet before enabling execution. Dashboard manual approvals are Enterprise; this is distinct from the Intents API.

Signer-specific override policies are not automatically an intersection with all other signer policies. Agent credentials must never acquire an admin signing fallback. Document exactly which restrictions Privy independently enforces versus Agentis application logic.

Documented stateful aggregates cover EVM signing/user operations with 1–72 hour rolling windows, not a general USD/multichain ledger. Transfer API chain/asset availability must be checked; generic EVM RPC support does not imply wallet-action support.

## Routes

All `/v1` routes require Bearer authentication. Bodies are bounded to 32 KiB and strictly validated.

| Route | Authority / result |
| --- | --- |
| `GET /health` | Public process health; not DB/provider readiness |
| `GET /v1/capabilities` | Authenticated, actual executor plus configured plugins/network metadata |
| `GET /v1/wallets` | Owner's safe wallet projection |
| `POST /v1/wallets` | Owner; verify existing Privy wallet before linking |
| `PATCH /v1/wallets/:id/policy` | Owner, complete policy replacement; invalidates pending authorizations |
| `POST /v1/grants` | Owner, token returned only at creation |
| `DELETE /v1/grants/:id` | Owner, revoke |
| `POST /v1/operations` | Owner or executor; mandatory `Idempotency-Key`; operation result |
| `GET /v1/operations[/:id]` | Scoped operation/status/receipt; list currently bounded to 100 |
| `POST /v1/operations/:id/approve` | Owner; `{operationHash}` required |
| `POST /v1/operations/:id/reject` | Owner; `{operationHash}` required |

Public operations never include signed bytes, token hashes or provider wallet IDs. Owner linking input necessarily identifies the provider wallet. Provider exceptions are sanitized; secrets/raw SQL are not returned in API errors.

## Local startup

1. `bun install && bun run build:packages` from root.
2. `docker compose -p agentis-rewrite up -d --wait` starts dedicated Postgres on **127.0.0.1:55432** (volume `agentis-rewrite_agentis_rewrite_pg`). Local-only credentials are in `.env.example`/Compose, not production secrets.
3. Set backend `DATABASE_URL` to that local DB in a private environment. `cd apps/backend && bun run db:migrate`.
4. Default `AGENTIS_EXECUTOR=disabled` permits no signing. For Anvil, start `anvil --host 127.0.0.1` separately, supply a fresh disposable `ANVIL_PRIVATE_KEY`, fund it **on that local node only**, set `AGENTIS_EXECUTOR=anvil` and a random `AGENTIS_LOCAL_OWNER_TOKEN` (32+ chars). Bootstrap registers a local-demo wallet; never repurpose a production private key.
5. Start API (`bun run index.ts`) and worker (`bun run worker`) in separate backend terminals with matching environment. Local mode binds API to loopback.
6. SDK/CLI can use the local owner token to list wallets/create a scoped grant, then use that grant for agent requests. Keep credentials out of command arguments/transcripts. Dashboard's Privy-authenticated UI does not impersonate the local-demo owner; use the owner SDK/CLI for local approvals.
7. Dashboard: `cd apps/next-app && bun dev`, with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001` and Privy app ID. `/dashboard/profile` handles hosted wallet access, `/operations/:id` reviews an operation. Guest wallet tryout remains available separately, including when signed in.

Do not overwrite existing private `.env` files or bootstrap against a production DB. Migrations are explicit, never applied automatically on server startup.

## Checks and known remaining work

- `bun run check`: package builds plus CLI/MCP/backend/dashboard typechecks.
- Automated suites were removed at the owner's request; use the manual authenticated wallet test page for creation/export checks.
- `bun run --filter next-app lint`; dashboard/worker builds separately.
- Live Privy authorization-key-owned testnet transfers are verified; logged-in browser-user E2E is not. `testing/privy-transfer-action-probe.ts --probe [base]` exercises unsigned action preparation and pending Intent cancellation, without supplying an owner signature. Webhook delivery is not implemented; SDK polling works.
- Missing production pieces: higher-level transfer-Intent integration, provider-enforced automation, browser E2E, core x402/MPP consumption, remote OAuth, rate limits, pagination, operator reconciliation UI, administration audit events, asset-aware USD valuation, production finality, plugins and funding integrations. The DNS-pinned, bounded payment HTTP transport is a tested prerequisite, not a working paid-fetch feature.
- Guest keys intentionally remain plaintext localStorage; local file wallets use standard SLIP-0010 derivation and 0600/0700 permissions. Both are trusted-device modes, not independent financial enforcement.
- Future plugin extraction must reuse existing standards-backed payment code/provider knowledge without restoring unsigned trust in quoted amounts, arbitrary signed transactions or provider bypass routes.

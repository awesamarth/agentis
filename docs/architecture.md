# Architecture

Agentis is a testnet-only financial execution platform for AI agents. Dashboard, SDK, CLI and remote MCP all use one backend and operation pipeline.

## Components

- `apps/backend`: Hono API, Postgres/Drizzle state, hosted execution, reconciliation and plugins.
- `apps/next-app`: owner dashboard, approvals and CLI/MCP consent flows.
- `packages/core`: shared Zod contracts and payment types.
- `packages/sdk`: thin HTTP client.
- `packages/cli`: hosted and local-custody commands.
- `packages/mcp`: remote MCP tools mounted by the backend.
- `apps/backend/src/plugins`: integration-specific code. `registry.ts` wires plugin metadata, routes and lifecycle hooks; ENS and Uniswap are per-agent plugins.

## Authority

Owners authenticate with Privy and can manage agents, rules, approvals, grants and exports. Agents receive scoped executor grants. A grant cannot change policy, issue credentials, export keys or approve its own payment.

Hosted wallets use Privy. Agentis enforces budgets and permissions in the backend and revalidates them before signing. Local CLI wallets are a separate custody model protected by local filesystem permissions and CLI policy; they are not hosted enforcement.

## Operation lifecycle

```text
authenticate → validate → reserve USD budget → approve/authorize
             → prepare and persist proof → submit → reconcile → receipt
```

Idempotency is scoped to the requesting principal. The same key with different terms is rejected. Signed bytes or payment proofs are persisted before submission and never returned publicly. Unknown submissions keep their reservation and are reconciled; they are not automatically resent.

Policies include per-transaction, rolling hourly/daily and lifetime USD limits across an agent's enabled networks. Fees are included. Policy, plugin, grant and wallet state are rechecked immediately before execution.

## Networks and payments

Hosted and local flows support Base Sepolia, Ethereum Sepolia, Arc Testnet, Tempo Testnet and Solana Devnet as documented in the root README. Direct transfers, x402 paid GET requests and Tempo MPP requests use the common lifecycle.

Uniswap provides Base Sepolia swaps, rebalancing, DCA, gas refill and optional x402 shortfall funding. ENS provides Sepolia ENSv2 identity, multichain payment records and internal ERC-8004 registration. Plugin IDs are validated by the shared core contract; the database stores a JSON array without hardcoding every allowed combination.

## Remote MCP

`/mcp` uses stateless Streamable HTTP and OAuth with S256 PKCE, explicit agent/network selection, short-lived access tokens and rotating refresh tokens. MCP tools dispatch through the same `/v1` API and live grant checks. MCP does not expose approval, policy mutation or key export.

## Runtime

Use Bun 1.3.14. Build workspace packages before backend or interface checks:

```sh
bun install --frozen-lockfile
bun run build:packages
docker compose -p agentis-rewrite up -d --wait
cd apps/backend
bun run db:migrate
bun run index.ts
```

Run the worker separately for local development. Production can set `AGENTIS_RUN_WORKER=true` to run reconciliation in the API process. Migrations are explicit and never run automatically on startup.

## Remaining work

- Real external MCP client/browser-consent verification.
- Remaining live ENS record-update and payment-to-name checks.
- Payment recovery for provably unused expired Tempo/Solana submissions.
- Rate limits, pagination, webhooks and operator recovery tooling.
- Mainnet support is not enabled or authorized.

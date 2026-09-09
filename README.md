# Agentis

SDK-first financial execution for agents. Developers integrate once; their users control wallet access, approvals, budgets and receipts.

**Rewrite checkpoint, not a production release.** Base is the target default chain; only local Anvil native transfers execute in this working tree. Privy authentication and read-only user-owned wallet linking are implemented; Privy signing/Intents, paid fetch, other chains and plugins are not enabled. Previously published packages/deployments still run the old prototype.

## Local development

```sh
bun install
bun run build:packages
docker compose -p agentis-rewrite up -d --wait
# Set DATABASE_URL in your private backend environment using .env.example.
cd apps/backend
bun run db:migrate
bun run index.ts
# Separate terminal, same backend environment:
bun run worker
```

Dashboard: `cd apps/next-app && bun dev`. Set `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001` and your Privy app ID. No environment files containing secrets are committed.

Execution defaults to **disabled**. For local Anvil, see [architecture and runbook](docs/architecture.md). No automatic migration of JSON data or mainnet execution.

## SDK

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const agentis = new AgentisClient({
  baseUrl: 'http://localhost:3001',
  token: process.env.AGENTIS_TOKEN!, // wallet-scoped executor grant
})
const operation = await agentis.operations.create({
  walletId: process.env.AGENTIS_WALLET_ID!,
  action: 'transfer',
  chainId: 'eip155:31337',
  asset: 'native',
  to: '0x0000000000000000000000000000000000001234',
  amountAtomic: '1000000000000000',
  maxFeeAtomic: '1000000000000000',
  reason: 'Local demo transfer',
}, { idempotencyKey: 'demo-task-1' })
// Reuse this key for retries of this task, never for a different task.
console.log(operation.status, operation.approvalUrl)
```

Runnable local owner → grant → approval → receipt example: `bun examples/operation.ts` (requires the local API/worker and a funded disposable Anvil wallet).

Approval is a normal asynchronous result. Agents cannot administer policy or approve themselves. The owner uses the dashboard or an owner-authenticated SDK client to approve the displayed `operationHash`. `operations.wait()` returns on approval-required, unknown or terminal status; it never resubmits payment.

## Validation

```sh
bun run check                   # builds packages, then typechecks interfaces/backend/dashboard
bun run test                    # unit tests + isolated Postgres/Anvil integration tests
cd apps/next-app && bun run lint
```

`test:backend` requires Docker Postgres above and Anvil on PATH. It creates/drops only uniquely named test databases on loopback, and starts/stops its own Anvil process using a random disposable key. No live funds are touched.

## Boundaries

- One operation pipeline and transactional budget reservations, including fee caps.
- Current budget model: **native atomic units per configured wallet/chain**, not cross-chain USD.
- Local Anvil approvals are application-level demo authorization; verified independent Privy user authorization is still outstanding.
- Unknown submissions retain reservations and block the wallet lane. Reconciliation never blindly broadcasts another transaction.
- Guest Solana devnet wallets remain in browser localStorage; explicitly insecure against same-origin scripts/device compromise. Never fund on mainnet.
- Local CLI wallet files use SLIP-0010 Ed25519 derivation and filesystem permissions, not empty-password encryption.
- Jupiter/Umbra/Link/paid-fetch plugins are explicitly unavailable pending migration. Remote MCP is also unavailable; local stdio uses executor grants.
- The Agentis facilitator product and Quasar enforcement wiring have been removed.

See [AGENTS.md](AGENTS.md) for the living handoff and [docs/architecture.md](docs/architecture.md) for decisions, API routes, verification gaps and next steps.

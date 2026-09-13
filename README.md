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
cd apps/next-app && bun run lint
```

Automated suites were removed at the owner's request. The standalone Privy wallet creation/export page is `/test` (no Agentis records).

## Boundaries

- One operation pipeline and transactional budget reservations, including fee caps.
- Current budget model: **native atomic units per configured wallet/chain**, not cross-chain USD.
- Local Anvil approvals are application-level demo authorization; verified independent Privy user authorization is still outstanding.
- Unknown submissions retain reservations and block the wallet lane. Reconciliation never blindly broadcasts another transaction.
- Guest Solana devnet wallets remain in browser localStorage; explicitly insecure against same-origin scripts/device compromise. Never fund on mainnet.
- Local CLI wallet files use SLIP-0010 Ed25519 derivation and filesystem permissions, not empty-password encryption.
- Remote MCP uses browser OAuth and the common backend at `/mcp`; see [connection/setup instructions](packages/mcp/README.md). No local MCP process or manual token copying. Local HTTP/SDK checks passed; actual client/browser consent and public deployment remain unverified/pending.
- x402/MPP paid GET uses the common hosted/local execution paths. The [per-agent Uniswap plugin](docs/uniswap.md) adds Base Sepolia swaps, rebalancing, DCA, gas refill and x402 shortfall funding. Real Privy swap/browser verification remains pending; Tempo MPP auto-funding has no supported Uniswap testnet route. ENSv2/ERC-8004 remain future work.
- Uniswap review pointers: [V3 quotes](apps/backend/src/modules/uniswap.ts#L37), [bounded router calldata](apps/backend/src/modules/uniswap.ts#L66), [persisted plan execution](apps/backend/src/modules/uniswap-service.ts#L64), [worker scheduling](apps/backend/src/modules/uniswap-service.ts#L256), [developer feedback](FEEDBACK.md).
- The Agentis facilitator product and Quasar enforcement wiring have been removed.

See [AGENTS.md](AGENTS.md) for the living handoff and [docs/architecture.md](docs/architecture.md) for decisions, API routes, verification gaps and next steps.

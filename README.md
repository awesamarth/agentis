# Agentis

Complete financial infrastructure for AI agents on Solana.

Agentis gives AI agents wallets, payment rails, spending controls, privacy flows, and yield access. It is built for agents that need to hold funds, pay for work, obey budgets, move privately, and put idle capital to use.

Agentis is live at [agentis.systems](https://agentis.systems). Documentation is available at [docs.agentis.systems](https://docs.agentis.systems).

## Why Agentis

AI agents are starting to transact onchain. They need to pay APIs, access x402 and MPP endpoints, interact with protocols, coordinate with other agents, and move funds on behalf of users.

A wallet alone is not enough for that. A serious spending agent needs:

- a wallet it can operate
- policy limits before money moves
- payment support for machine-payable endpoints
- privacy when flows should not be public
- yield for idle funds
- interfaces that both humans and agents can use

Agentis brings those pieces into one Solana-native control plane.

## What Agentis Includes

### Agent wallets

Create hosted agent wallets from the dashboard, CLI, or MCP server. Agentis also supports local encrypted wallets through the CLI for users who want local custody.

### Payments

Agents can pay x402 and MPP protected endpoints through the Agentis SDK, CLI, or MCP server. `agentis.fetch()` and `agentis fetch` handle payment-required responses, check policy, and route the payment through the selected agent wallet.

### Policy enforcement

Agentis policies are checked before spends happen. Policies can include max-per-transaction limits, daily budgets, total budgets, allowed domains, and kill switches. Quasar-based on-chain policy checks are supported for direct SOL sends on Solana devnet.

### Privacy

Private agent wallets use Umbra privacy flows. Agents can register for privacy, inspect encrypted balance, deposit, withdraw, create receiver-claimable UTXOs, scan, and claim.

### Jupiter Earn

Agentis can deposit idle mainnet USDC into Jupiter Earn, show Earn positions, withdraw supplied USDC, and sweep non-zero USDC balances across hosted agents.

### Human and agent interfaces

Agentis can be operated from:

- Dashboard, for humans managing agents visually
- CLI, for local workflows and scripts
- SDK, for apps and agent runtimes
- MCP, for AI assistants and coding agents
- SKILL.md, so agents can understand how to use Agentis

## Quick Start

Create an account on the [Agentis dashboard](https://agentis.systems/dashboard), then create an agent wallet.

You can also start from the CLI:

```bash
npx @agentis-hq/cli login
npx @agentis-hq/cli wallet create --name my-agent
npx @agentis-hq/cli agent list
```

Fetch a paid URL through an agent wallet:

```bash
npx @agentis-hq/cli fetch https://example.com/paid-data --agent my-agent
```

Set policy limits before the agent spends:

```bash
npx @agentis-hq/cli policy set my-agent --max-per-tx 1 --daily 10 --budget 100
```

See the [quick start docs](https://docs.agentis.systems/docs/agentis) for the full path.

## Agent Skill

Agentis includes an installable `SKILL.md` for compatible coding agents. The skill tells an AI agent how to choose between the dashboard, CLI, SDK, and MCP server, and how to operate Agentis safely.

Install it with the Vercel Agent Skills CLI:

```bash
npx skills add awesamarth/agentis
```

The skill lives at [`skills/agentis/SKILL.md`](skills/agentis/SKILL.md).

## CLI

Install globally:

```bash
npm install -g @agentis-hq/cli
agentis
```

Or run directly:

```bash
npx @agentis-hq/cli --help
```

Common commands:

```bash
agentis login
agentis wallet create --name my-agent
agentis wallet create --name local-agent --local
agentis agent list
agentis agent balance my-agent
agentis fetch https://example.com/paid-data --agent my-agent
agentis policy set my-agent --max-per-tx 1 --daily 10
agentis earn positions my-agent --mainnet
agentis privacy status --agent my-agent
```

Read the [CLI docs](https://docs.agentis.systems/docs/cli) or the package README at [`packages/cli`](packages/cli).

## SDK

Install:

```bash
npm install @agentis-hq/sdk
```

Use Agentis from an app backend or agent runtime:

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const agentis = await AgentisClient.create({
  apiKey: process.env.AGENTIS_API_KEY!,
})

const res = await agentis.fetch('https://example.com/paid-data')
const data = await res.json()

await agentis.policy.update({
  maxPerTx: 1,
  dailyLimit: 10,
})
```

The SDK is intended for trusted server-side or agent-runtime environments. Do not expose Agentis API keys in browser clients.

Read the [SDK docs](https://docs.agentis.systems/docs/sdk) or the package README at [`packages/sdk`](packages/sdk).

## MCP

Agentis ships a local stdio MCP server for AI assistants that support MCP.

```bash
npm install -g @agentis-hq/mcp
```

Example MCP config:

```json
{
  "mcpServers": {
    "agentis": {
      "command": "agentis-mcp",
      "env": {
        "AGENTIS_ACCOUNT_KEY": "agt_user_..."
      }
    }
  }
}
```

The MCP server exposes account-level tools for listing agents, creating agents, reading balances, sending SOL, fetching paid URLs, updating policy, using Jupiter Earn, and operating Umbra privacy flows.

Read the [MCP docs](https://docs.agentis.systems/docs/mcp) or the package README at [`packages/mcp`](packages/mcp).

## Packages

| Package | Purpose |
| --- | --- |
| [`@agentis-hq/core`](https://www.npmjs.com/package/@agentis-hq/core) | Shared types and policy engine |
| [`@agentis-hq/sdk`](https://www.npmjs.com/package/@agentis-hq/sdk) | Runtime SDK for agent wallets and paid fetches |
| [`@agentis-hq/cli`](https://www.npmjs.com/package/@agentis-hq/cli) | Command line interface |
| [`@agentis-hq/mcp`](https://www.npmjs.com/package/@agentis-hq/mcp) | Local stdio MCP server |

## Security Model

Agentis separates account access from agent access.

- Account keys are used by the CLI and MCP server to operate an account's agents.
- Agent API keys are scoped to individual agent wallets and are used by the SDK.
- Full keys are shown only when created or regenerated.
- Backend reads return masked key metadata, not plaintext keys.
- Policies are checked before signing or proxying spends.

Mainnet actions, including Jupiter Earn, move real funds. Review agent policies and balances before enabling autonomous workflows.

## Status

Agentis is early, live, and actively changing. The current product supports hosted agent wallets, local CLI wallets, policy controls, x402/MPP paid fetches, Umbra privacy flows, Jupiter Earn, the dashboard, CLI, SDK, MCP server, and agent skill instructions.

Swaps, deeper facilitator tooling, richer production observability, and exportable self-custodial hosted wallets are planned next steps.

## Links

- Website: [agentis.systems](https://agentis.systems)
- Dashboard: [agentis.systems/dashboard](https://agentis.systems/dashboard)
- Docs: [docs.agentis.systems](https://docs.agentis.systems)
- CLI package: [`@agentis-hq/cli`](https://www.npmjs.com/package/@agentis-hq/cli)
- SDK package: [`@agentis-hq/sdk`](https://www.npmjs.com/package/@agentis-hq/sdk)
- MCP package: [`@agentis-hq/mcp`](https://www.npmjs.com/package/@agentis-hq/mcp)

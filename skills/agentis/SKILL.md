---
name: agentis
description: Use when an AI agent needs to operate Agentis, the Solana financial infrastructure for AI agents: agent wallets, x402/MPP paid fetches, policy limits, Umbra privacy, Jupiter Earn, dashboard, CLI, SDK, or MCP tools.
---

# Agentis

Agentis is financial infrastructure for AI agents on Solana. It gives agents wallets, payment rails, spending policies, privacy flows, and Jupiter Earn access.

Use Agentis when the user wants an agent to hold funds, pay an API or wallet, inspect balances, obey spend controls, move privately, or manage yield.

## Pick The Interface

Use the interface that matches the current environment:

- **CLI**: best default when shell access is available. It is the broadest interface and supports hosted wallets, local wallets, paid fetches, policy, Umbra, Jupiter Earn, and facilitator scaffolding.
- **MCP**: best when Agentis tools are already connected to the host agent. Prefer MCP for structured state/action calls from an AI assistant because results come back as JSON.
- **SDK**: best when writing app code or agent runtime code that needs Agentis programmatically.
- **Dashboard**: best when a human should review agents, balances, policy, privacy, or Jupiter Earn state visually.

Do not assume the repo is present or that a local backend is running. Normal users should use the hosted Agentis service through the published CLI, MCP server, SDK, or dashboard.

## CLI

Run:

```sh
agentis
```

If unsure about syntax, ask the CLI:

```sh
agentis --help
agentis agent create --help
agentis earn withdraw --help
agentis privacy create-utxo --help
```

Common commands:

```sh
agentis login
agentis whoami

agentis wallet create --name my-agent
agentis wallet create --name my-agent --local
agentis wallet list

agentis agent list
agentis agent create my-agent
agentis agent create my-agent --onchain-policy
agentis agent balance my-agent
agentis agent send my-agent <to-wallet> 0.001 --sol

agentis fetch <url> --agent my-agent

agentis policy get my-agent
agentis policy set my-agent --daily 5 --max-per-tx 1

agentis earn positions my-agent --mainnet
agentis earn deposit my-agent --asset USDC --amount 1 --mainnet
agentis earn withdraw my-agent --asset USDC --mainnet
agentis earn withdraw my-agent --asset USDC --amount 1 --mainnet
agentis earn sweep --dry-run

agentis privacy status --agent my-agent
agentis privacy balance --agent my-agent
agentis privacy scan --agent my-agent
agentis privacy claim-latest --agent my-agent

agentis facilitator create my-facilitator
agentis facilitator list
agentis facilitator publish <name-or-id> --url <public-url> --listed
```

For Jupiter Earn, `--mainnet` is required. Omitting `--amount` on `earn withdraw` redeems the full USDC Earn position.

## MCP

Use MCP if the host environment has an Agentis MCP server configured. It requires an Agentis account key, usually named `AGENTIS_ACCOUNT_KEY`, in the MCP server environment.

Important tools:

```txt
agentis_cli_help
agentis_list_agents
agentis_create_agent
agentis_agent_balance
agentis_send_sol
agentis_fetch_paid_url
agentis_policy_get
agentis_policy_check
agentis_policy_update
agentis_policy_init_onchain
agentis_policy_read_onchain
agentis_earn_deposit
agentis_earn_positions
agentis_earn_sweep
agentis_privacy_status
agentis_privacy_register
agentis_privacy_balance
agentis_privacy_deposit
agentis_privacy_withdraw
agentis_privacy_create_utxo
agentis_privacy_scan
agentis_privacy_claim_latest
agentis_scaffold_facilitator
agentis_list_facilitators
agentis_register_facilitator
agentis_publish_facilitator
```

MCP currently supports Earn deposit, positions, and sweep. Use the CLI for Jupiter Earn withdraw unless an MCP withdraw tool is added.

## SDK

Use the SDK when writing code:

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const agent = await AgentisClient.create({
  apiKey: process.env.AGENTIS_API_KEY!,
})

const response = await agent.fetch('https://example.com/paid-data')
const signature = await agent.pay('<wallet>', 0.001)
const policy = await agent.policy.get()
```

`agent.fetch()` detects MPP/x402 `402 Payment Required` responses, checks policy, and routes payment through Agentis. Use `agent.policy.update(...)` for policy changes and `agent.privacy.*` for Umbra flows.

## Policy

Agentis policy amounts are USD-denominated.

Common controls:

```txt
killSwitch
maxPerTx
hourlyLimit
dailyLimit
monthlyLimit
maxBudget
allowedDomains
```

Before a spend, check policy when possible. If a policy rejects an action, do not retry by weakening limits unless the user explicitly authorizes it.

## Privacy

Umbra privacy is for private-agent flows.

Safer read/default actions:

```sh
agentis privacy status --agent <agent>
agentis privacy balance --agent <agent>
agentis privacy scan --agent <agent>
```

State-changing actions:

```sh
agentis privacy register --agent <agent>
agentis privacy deposit --agent <agent> --amount <atomic>
agentis privacy withdraw --agent <agent> --amount <atomic>
agentis privacy create-utxo --agent <agent> --to <wallet> --amount <atomic>
agentis privacy claim-latest --agent <agent>
```

Amounts are atomic token units. UTXO/private-transfer flows can hide sender-recipient links but may depend on relayer/indexer availability.

## Jupiter Earn

Jupiter Earn support in Agentis is mainnet-only and currently focused on USDC.

Read first:

```sh
agentis earn positions <agent> --mainnet
```

Deposit:

```sh
agentis earn deposit <agent> --asset USDC --amount 1 --mainnet
```

Withdraw all supplied USDC:

```sh
agentis earn withdraw <agent> --asset USDC --mainnet
```

Withdraw a specific UI amount:

```sh
agentis earn withdraw <agent> --asset USDC --amount 1 --mainnet
```

Sweep should be dry-run first:

```sh
agentis earn sweep --dry-run
```

Do not attempt a devnet Jupiter Earn transaction path.

## Safety

- Never expose full Agentis API keys except when the product explicitly returns them during creation/regeneration.
- Prefer read commands before write commands.
- Confirm with the user before moving mainnet funds unless they already gave clear approval.
- Prefer `earn sweep --dry-run` before executing a sweep.
- Treat `--mainnet` commands as real-money actions.

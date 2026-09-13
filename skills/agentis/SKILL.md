---
name: agentis
description: Use Agentis to operate agent wallets, check balances and budgets, send tokens, pay x402/MPP APIs, swap with Uniswap, and manage ENS identity through CLI, SDK or remote MCP.
---

# Agentis

## Start here

- Prefer the CLI when shell access is available. Install with `bun add -g @agentis-hq/cli@latest` if missing; Bun must be on PATH. Run `agentis whoami`, then `agentis --help --agent <name-or-id>` to discover commands for the selected agent. Use command help rather than guessing flags.
- The default backend is **https://api.agentis.systems**. Do not use localhost unless explicitly testing a separate development backend. If not connected, run `agentis login` and give the owner its browser URL/code to select agents and networks. A login bound to another API needs logout/login; do not rewrite credentials or expand grants yourself.
- Start with `agentis wallet list --hosted`, `agentis wallet balance --hosted --agent <agent>` and `agentis policy show --agent <agent>`. Choose the intended wallet/network before requesting money movement. `--json` gives structured output.

## Choose the action

- **Send:** `agentis wallet send --hosted --wallet <wallet-id> --chain <chain> --to <address-or-ENS-name> --asset <symbol> --amount <decimal> --key <unique-task-key>`. CLI amounts/fee budgets are decimal token units; low-level operations use atomic strings.
- **Paid API:** `agentis fetch <url> --wallet <wallet-id> --max-amount-atomic <cap> --key <unique-task-key>`. Inspect help for protocol-specific fee flags. Bound the spend; use the requested seller URL, not an invented endpoint.
- **Uniswap:** select an agent with the plugin enabled. Discover `swap`, `rebalance` and `dca` through `agentis --help --agent <agent>`. Quote before execution; pass its `minimumOutputAtomic` / `maximumInputAtomic` into execute as `--minimum-output-atomic` / `--maximum-input-atomic`. Base Sepolia ETH/USDC only. `fetch --swap-funding` opts into funding only the missing Base USDC. Schedule/plugin setup requires owner consent.
- **ENS:** use `identity resolve|show|setup|update|delegate|revoke`. ENSv2 on Ethereum Sepolia supplies real names, per-network wallet records and endpoint/description delegation; ERC-8004 is internal to this single plugin. Setup/delegation returns owner-review links. Agents cannot change protected payment-address records or another name; record writes still require spending approval/budgets.
- **Local custody:** use `wallet create --local` and the `--local` variants of balance, send, fetch, policy and history. Discover exact flags with help. Keys stay in plaintext, permission-protected files on the machine; local rules are software safeguards, not tamper-proof enforcement. Do not read/print mnemonics or switch custody to bypass hosted restrictions.

## Other interfaces

- **Remote MCP:** connect **https://api.agentis.systems/mcp**, then browser OAuth with owner-selected agents/networks. No local MCP process or manually copied owner token. Start with `agentis_capabilities` and `agentis_list_wallets`; use balance/policy/history tools before send/fetch. Plugin tools depend on enabled plugins. MCP exposes hosted wallets only.
- **SDK:** `new AgentisClient({ baseUrl: 'https://api.agentis.systems', token })` from `@agentis-hq/sdk`. Use a scoped executor key, never an owner credential to bypass restrictions. `client.operations`, `client.fetch`, `client.uniswap` and `client.identity` expose the common backend operations. Consult package types/current CLI help for exact inputs.

## Money boundaries

- **Testnets only:** Base and Ethereum Sepolia ETH/USDC; Arc USDC; Solana SOL/USDC; Tempo alphaUSD. x402 uses USDC on supported seller/facilitator networks, including Sepolia only when advertised; MPP uses Tempo alphaUSD. No mainnet, bridge or automatic cross-chain funding.
- **Ask mode:** return the approval URL promptly and wait for the owner. Never approve yourself, change mode/limits, export keys or manufacture owner authentication. `--yes` skips CLI confirmation, not backend approval. Automatic mode still enforces policy; paused means stop.
- Keep the **same idempotency key and exact terms** across retries. Check `operations get|wait <id>` or `swap get <plan-id>` for progress and receipts. Unknown submission or failed HTTP response does not prove no payment occurred; never blindly create a replacement payment. Report approval-required/submitted separately from confirmed settlement.
- Hosted USD caps are per agent, shared across its networks and credentials, including fee reservations and actual settlement fees. Different agents have independent limits. Insufficient funds, missing scope or disabled plugins need owner action—not another wallet, stronger credentials or relaxed policy. Never print keys or tokens.

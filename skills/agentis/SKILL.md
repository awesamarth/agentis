---
name: agentis
description: Use Agentis remote MCP, SDK or CLI for scoped agent wallets, balances, policies, payments and receipts.
---

# Agentis

Use the configured remote MCP connection or the current checkout's CLI/SDK. The old published CLI may differ; inspect `AGENTS.md` and CLI `--help` before assuming commands exist.

- Remote MCP: connect the URL, authenticate through browser OAuth and have the owner select agents/networks. No local MCP process or manually copied owner token. Public deployment is separate from this implementation.
- Start with `agentis_list_wallets` and `agentis_capabilities`. Read `agentis_balance`, `agentis_policy` and `agentis_history`; use authorized wallet IDs with `agentis_send` or `agentis_fetch`. Friendly tools accept decimal token amounts. Advanced `agentis_request_operation` and SDK operations use atomic strings.
- Ask mode returns an approval URL for the human. Automatic mode queues execution within policy; use `agentis_get_operation` for progress/receipt/paid response. Never approve yourself, export keys or edit policy through MCP. A client-side tool allowance is not payment approval.
- Keep the exact idempotency key and terms across retries. Unknown or failed HTTP response does not prove no payment occurred; reconcile, never blindly create another payment.
- All hosted payments use shared per-agent USD limits across networks/keys, including maximum fee reservations and actual settlement fees. Different named agents have independent budgets. Restricted history includes all issuing keys within authorized wallets/networks; operation control remains separately scoped.
- Supported testnet sends: Base ETH/USDC, Arc USDC, Tempo alphaUSD, Solana SOL/USDC. Paid GET: Base/Arc/Solana x402 USDC and Tempo MPP alphaUSD. Mainnet spending is not authorized. Uniswap, ENSv2/ERC-8004 and other integrations remain planned, not implemented.
- CLI browser login can authorize multiple agents; SDK uses scoped executor grants. Never print credentials or give an agent owner credentials to bypass approval.
- Local custody is CLI-only: plaintext mnemonic protected by filesystem permissions. Local software policies are useful safeguards, not tamper-proof custody enforcement. MCP exposes hosted wallets only.

---
name: agentis
description: Use Agentis CLI to check agent wallets and budgets, send tokens, pay x402/MPP APIs, and use Agentcard, Uniswap or ENS through hosted permissions and approvals.
---

# Agentis

Use the installed `agentis` CLI. Version **0.7.1+**:
```sh
bun add -g @agentis-hq/cli@0.7.1
```
Default API: `https://api.agentis.systems`. MCP: `https://api.agentis.systems/mcp`.

## Execute directly

- Use known wallet/agent IDs. No ritual help, login, wallet, balance or policy checks.
- Run `agentis login` only when needed. Never switch accounts, API URLs or grants without permission.
- Use `--json` for structured results. Run `agentis --help` only when command syntax or flags are unknown.
- Hosted custody is the default here. **Never use `--local` unless explicitly requested.**
- Mainnet and testnet are supported; respect the selected wallet/network, consent and spending limits.

```sh
agentis wallet list --hosted --json
agentis wallet balance --hosted --wallet <wallet-id> --json
agentis wallet send --hosted --wallet <wallet-id> --chain <network-key> --to <address> --asset <symbol> --amount <decimal> --max-fee <decimal> --json
agentis fetch <url> --wallet <wallet-id> --asset <symbol> --max-amount-atomic <cap> --max-fee-atomic <fee-cap> --method POST --header 'Content-Type: application/json' --data '<body>' --json
agentis operations get <operation-id> --json
agentis operations wait <operation-id> --json
```

- List wallets only if the intended wallet is unknown. Check balance/policy when asked or diagnosing a relevant failure.
- Network keys include `base`, `tempo`, `solana`; mainnet sends use recipient addresses.
- Send amounts/fees are decimal token units. Fetch caps are atomic: Tempo USDC.e has 6 decimals; Tempo fee caps use 18 protocol decimals; Solana fee caps use lamports. Fee cap `0` requires sponsored MPP gas.
- Paid HTTP supports exact bodies and headers, with a 120-second response deadline and 10 MiB response limit.

## Request identity and outcomes

- A bare hosted payment command creates and saves a **new request ID**. `--key` is optional.
- To explicitly retry, repeat the exact command with `--retry <saved-request-id>` (or `--retry latest`). Never combine `--retry` and `--key`. Changed terms are rejected.
- After uncertainty, inspect the original operation first. **Never blindly repeat a bare payment command or resend a successful payment.**
- Ask mode: return the operation’s `approvalUrl` directly to the requesting owner as a clickable link, with the amount and operation ID. Do not hide it or make the owner search the dashboard. Never approve yourself or bypass policy.
- Payment confirmation is separate from provider success. Inspect `httpResponse`; decode `bodyBase64` for the provider result. A transaction hash is not a video/job result.
- Display token fees using `receipt.feePayment`; do not add it to `feeAtomic`—they describe the same fee. Balance display can lag by 120 seconds.

## Other features

- Agentcard: `agentis cards`; owner Vault connection and separate card permission required. Search/cart creation is not a completed purchase. Card accounting is USD-only. Keep secret-bearing Vault enrollment/provider links and card credentials out of agent chat; ordinary Agentis dashboard approval links may be shown to the requesting owner.
- Uniswap and ENS: `agentis swap`, `agentis rebalance`, `agentis identity`. Existing plugin execution remains testnet-scoped.
- SDK callers persist explicit idempotency keys. MCP keys are optional, but every omitted key creates a new request; never retry a keyless payment blindly.
- Never expose keys, tokens, signed transactions or card credentials. Never create agents, expand grants or spend without authorization. Agentis owner-facing `approvalUrl` links are allowed and should be returned when approval is needed.

# Uniswap plugin

Per-agent hosted-wallet integration. Enable Uniswap in agent setup (step 3), or the agent page's **Add a plugin** picker. Currently Base Sepolia ETH/USDC only. Local-custody wallets are not supported by this plugin.

## Interfaces

- Dashboard: swap preview/request, saved manual ETH/USDC allocation targets, DCA create/edit/pause/resume/cancel and recent runs, optional ETH gas-refill threshold/target.
- CLI: `swap quote|execute|get`, `rebalance`, `dca create|list|show|edit|pause|resume|cancel`. Interactive inputs or explicit flags. Help exposes these only for a selected connected agent with Uniswap. `fetch ... --swap-funding` opts into Base USDC shortfall funding.
- MCP: `agentis_swap_quote`, `agentis_swap`, `agentis_swap_get`, `agentis_rebalance_preview`, `agentis_rebalance`, `agentis_dca_list`, `agentis_dca_get`, `agentis_dca_request_setup`. Listed when at least one delegated agent enables Uniswap; authorization is still per wallet/agent. Existing `agentis_fetch` accepts `swapFunding: true` for Base.
- SDK: `client.uniswap.quote/swap/get/target/saveTarget/rebalance/executeRebalance/fetch`, `client.uniswap.dca.list/create/update/status/requestSetup`. Direct owner schedule creation requires a stable `id`; restricted clients request browser confirmation instead.

```sh
bun packages/cli/src/index.ts swap quote --agent research-agent --from ETH --to USDC --amount 0.001
bun packages/cli/src/index.ts swap execute --agent research-agent --from ETH --to USDC --amount 0.001 --key unique-swap-1 --yes
bun packages/cli/src/index.ts rebalance --agent research-agent --eth-percent 20 --preview
bun packages/cli/src/index.ts dca create --agent research-agent --from USDC --to ETH --amount 1 --every-minutes 1440
```

`--yes` skips the CLI confirmation only. Ask mode still returns owner approval links. Preserve the request key and terms after uncertainty; use `swap get <plan-id>` to inspect linked operations. Interactive swap previews print their atomic retry bounds. DCA commands return a browser confirmation URL—no owner token copying.

## Implementation and contracts

- [`plugins/uniswap/swap.ts`](../apps/backend/src/plugins/uniswap/swap.ts): four V3 fee-tier quotes, exact-input/output bounds, fixed router calldata, exact token allowance and pool validation.
- [`plugins/uniswap/service.ts`](../apps/backend/src/plugins/uniswap/service.ts): persisted plans, allowance → swap → optional payment, owner-confirmed schedules, saved allocation targets and worker scheduling.
- [`operations.ts`](../apps/backend/src/operations.ts): common reservations, hash-bound approvals, plugin/schedule revalidation and actual-input USD settlement.
- [`privy-executor.ts`](../apps/backend/src/providers/privy-executor.ts): existing Privy signer, signed-transaction matching, V3 swap/approval receipt checks.

Pinned Base Sepolia deployments from [Uniswap's official deployment list](https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments):

| Contract | Address |
|---|---|
| Factory | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| QuoterV2 | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` |
| SwapRouter02 | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |

The Base Sepolia Trading API returned `404 UpstreamTimeoutError`, while the deployed V3 quoter returned usable ETH/USDC quotes. This implementation explicitly uses direct V3 contracts, not API-generated calldata. No Uniswap API key is required for this path. The owner's root `UNISWAP_KEY` was used only for API diagnostics and was not exposed to clients.

## Execution behavior

The existing backend/worker and Postgres run everything. No separate signer, DCA service or plugin budget. ERC20 allowance is exact-amount and charges fees only; swaps reserve maximum input plus fees and settle actual input plus actual fees. Ask mode may require separate allowance and swap approvals. Market quotes/slippage protection do not guarantee fair market value.

Shortfall funding: discover the seller's Base USDC requirement, read balance, swap ETH for only the missing USDC with exact output, then let the existing paid-fetch engine discover fresh terms and pay within the original maximum. Funding and ordinary payment share the original payment idempotency key. A successful swap is not rolled back if the later HTTP/payment fails; linked receipts show each result.

Schedules persist a fixed interval and one deterministic plan per occurrence. The worker avoids overlapping/catch-up runs. Pause/edit invalidates unsubmitted scheduled operations. Disabling the plugin pauses its schedules and denies unsubmitted plugin operations; re-enabling does not silently resume them. Issued transactions still reconcile. Gas refill uses USDC → ETH toward the target plus bounded transaction-fee allowance and checks every five minutes; it cannot rescue a wallet with no gas.

Saved allocation targets are remembered manual-task preferences, not automatic trading mandates or spending permissions. Recent schedule history is bounded to the latest 100 wallet plans, up to 20 per schedule; full pagination is not implemented.

## Verification and limits

- Package builds, backend/dashboard typechecks and targeted lint passed.
- `testing/uniswap-check.ts`: isolated Postgres and fake signer; validates scopes, calldata, owner setup/replay, concurrent schedule idempotency, pause/revision changes, shortfall funding, payment chaining, actual-input accounting and zero caps. Native MCP SDK tool calls included.
- Real Base Sepolia pool discovery and quotes succeeded. The dashboard owner-approval flow also confirmed a Privy-executed **0.000001 ETH → 0.00326 USDC** swap: [transaction](https://sepolia.basescan.org/tx/0x8c740f96a453072a4e31273858874cacc05377d649d190f0e5af7ecfe4012f99).
- Uniswap's API rejects Tempo testnet `42431` with `RequestValidationError`; its supported Tempo chain is `4217`. Existing Tempo MPP payments remain available, but **MPP auto-funding is not implemented**. No mainnet workaround or testnet bridge is claimed.
- Migrations `0013_uniswap_execution.sql` and `0014_uniswap_targets.sql` are applied in the deployed database. The [dashboard](https://www.agentis.systems/dashboard) and [backend](https://api.agentis.systems/health) are live; Railway runs the API and reconciliation worker together.

See [FEEDBACK.md](../FEEDBACK.md). The project author has completed the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).

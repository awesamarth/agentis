# Uniswap developer feedback — Agentis

Agentis integrates Uniswap V3 with scoped agent wallets, owner approvals, shared USD budgets, swaps, DCA and paid-API funding. [Integration code, contracts and verification](docs/uniswap.md).

## What worked

- The Base deployment table identified the exact Sepolia Factory, QuoterV2 and SwapRouter02 addresses. On-chain pool lookup and ETH/USDC quotes worked across four fee tiers.
- V3 exact-output swaps fit payment shortfalls: acquire the missing payment-token amount with a bounded input.
- The official `uniswap-ai` repository provides relevant agent examples, including pay-with-any-token and DCA.

## Friction and suggestions

- The supported-chains page lists Base Sepolia API access, but our `/v1/quote` requests returned HTTP 404 `UpstreamTimeoutError` for native ETH/WETH → the canonical Base Sepolia USDC, including V3-only and V3/V4 requests. Direct on-chain quotes for that pair succeeded. Clearer testnet RPC/route diagnostics would help distinguish outages from missing liquidity.
- Tempo is listed as chain `4217`; our existing testnet `42431` was rejected with HTTP 400 `RequestValidationError`. A prominent per-network testnet-support matrix would help agent-payment integrations avoid assuming mainnet support includes their testnet.
- The pay-with-any-token guide lists x402 v1 and a mainnet Tempo funding flow. Explicit current-version and testnet guidance would help integrators using x402 v2.

These are observed integration notes, not a claim that the complete browser/Privy swap flow is verified. Real swap settlement remains to be tested; no funds were moved in the isolated authorization/accounting checks.

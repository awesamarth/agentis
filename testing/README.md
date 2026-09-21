# Focused integration checks

This directory contains standalone checks and local protocol fixtures. There is no root automated test suite.

Current checks cover hosted/local wallet behavior, CLI consent, scoped reads, remote MCP OAuth, Uniswap planning/execution, x402 settlement and provider probes. Several scripts require private environment variables, a dedicated local Postgres instance or funded testnet wallets; inspect a script before running it.

Local seller fixtures:

- `x402-server/`: x402 fixture.
- `mpp-server/`: Solana MPP fixture.

Use `bun run check` from the repository root for package builds and TypeScript checks. Run live scripts only with explicit approval and testnet funds. Never point them at mainnet or a stale production database.

# Focused integration checks

This directory contains focused checks and local protocol fixtures. Run `bun run check:offline` from the repository root for the curated regression suite: catalog/transfer validation, display pricing, grouped wallet addresses, balance-request deduplication, local custody/policies, scoped reads, settlement headers, fee sizing, Tempo multi-token/MPP boundaries and cryptographic price verification. Its standalone Tempo signing check also exercises the installed MPP client against fake RPC/signing. It builds workspace packages, uses disposable wallet fixtures and mocked or loopback HTTP, and needs no database, credentials or funded wallets.

The suite names its checks explicitly. Do not replace it with an indiscriminate run of this directory: other scripts include live provider probes and recovery tools.

Current checks cover hosted/local wallet behavior, CLI consent, scoped reads, remote MCP OAuth, Uniswap planning/execution, x402 settlement and provider probes. Several scripts require private environment variables, a dedicated local Postgres instance or funded testnet wallets; inspect a script before running it.

Local seller fixtures:

- `x402-server/`: x402 fixture.
- `mpp-server/`: Solana MPP fixture.

Use `bun run check` from the repository root for package builds and TypeScript checks. Database-backed CLI login, MCP/OAuth, network-accounting and `tempo-accounting-check.ts` checks remain separate and use isolated local fixtures. `tempo-readonly-check.ts` is an explicit live read-only probe (run from `apps/backend`); it reads token/RPC/oracle metadata and unpaid seller offers, never signs or submits. Do not include it in the offline suite. Run live scripts only with explicit approval and testnet funds. Never point them at mainnet or a stale production database.

# Testing

**New tests: only a small number of feature-relevant E2E tests.** No new unit/helper suites or mocked test matrices. Hosted payment E2E means the real backend, owner approval/policy, real Privy signing, chain settlement and provider result—not a local-key wallet or fake custody adapter. If blocked, report it; do not substitute custody or claim verification.

## Retained safety regressions

`bun run check:offline` builds workspace packages and runs existing checks for wrong-chain/token rejection, exact payment approvals/signing, fee/budget limits, oracle signature/freshness, HTTP bytes/settlement headers, custody-file protections and scoped access. It needs no database, private credentials or funded wallets. These regressions are supplementary, not hosted E2E evidence; routine changes need only relevant checks, not the whole suite.

Display/grouping/cache, transfer-helper, mocked discovery and standalone ENS fee-sizing tests were removed. `bun run check` remains the build/typecheck command.

## Separate checks and fixtures

- Database-backed CLI login, MCP/OAuth, network accounting and Tempo accounting checks use isolated local schemas; inspect their requirements before running.
- `solana-mpp-local-check.ts [--splits]`: disposable local CLI + Surfpool Devnet fork; **not real Privy or public Solana verification**.
- `tempo-splits-live-check.ts --testnet [--push]`: faucet-funded disposable local keys + official SDK seller on public Moderato; **not hosted Privy verification**. Push checks include POST, HTTP success/post-payment failure and same-key no-resend. This script remains testnet-only.
- `tempo-readonly-check.ts`: explicit live read-only RPC/oracle/unpaid-offer probe, run from `apps/backend`; never signs/submits and is not part of the offline suite.
- `hosted-mpp-seller.ts --serve-mainnet` (from `apps/backend`): controlled official-SDK Tempo/Solana seller on loopback port 19042 for real hosted Privy/mainnet E2E. It never signs for the agent or creates/approves operations; receiver keys stay in ignored `.agentis-local/`. Enable only this exact origin in the local API/worker transport allowlist. Hosted mainnet Tempo self-paid pull/push and sponsored pull splits passed. Solana self-paid/sponsored USDC splits and SOL single charges also passed, including HTTP results, independent chain checks and same-key no-resend. The receiver can sponsor fees with its own key/funds; it never receives the Agentis payer key.
- `x402-server/` and `mpp-server/`: local seller fixtures.

Never indiscriminately run this directory: it contains live/funded scripts and private recovery tools. Mainnet test spending is authorized only for hosted Privy `testing-another-agent`, with existing policies and owner approvals; see [AGENTS.md](../AGENTS.md). Authorization is not an instruction to initiate payments. Never point isolated checks at production/stale database snapshots, use unrelated wallets or run private recovery scripts as tests.

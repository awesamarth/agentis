# Agentis CLI (rewrite)

Run from the repo after `bun run build:packages`: `bun packages/cli/src/index.ts --help`.

Set `AGENTIS_API_URL` (defaults to loopback port 3001) and `AGENTIS_TOKEN` in a private environment. Use scoped executor grants for agents, not owner credentials.

- `wallet list [--local]`
- `wallet create --local --name <name>`
- `operations create --file <request.json> --key <stable-idempotency-key>`
- `operations list|get <id>|wait <id>`
- `operations approve|reject <id> --hash <operation-hash>` (owner only)
- `capabilities`

Local Solana wallets use web3.js v3 RC + standard SLIP-0010 Ed25519 derivation. Mnemonics are stored in `~/.agentis/wallets-v2` with 0700 directory/0600 file permissions, not printed to stdout. Anyone with file access can recover the wallet. Local sends and legacy hosted commands are not exposed until migrated.

No facilitator functionality remains. Mainnet execution, live Privy execution and plugins are unavailable. Published npm CLI is still the old prototype; use this checkout for the rewrite.

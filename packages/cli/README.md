# Agentis CLI

Command line tools for Agentis, the financial infrastructure layer for AI agents on Solana.

The CLI lets you create agent wallets, manage spend policies, pay MPP and x402 URLs, work with Umbra privacy flows, deposit idle USDC into Jupiter Earn, and scaffold x402 facilitators.

![Agentis CLI help](https://unpkg.com/@agentis-hq/cli/assets/agentis-help.png)

## Install

Run without installing:

```bash
npx @agentis-hq/cli --help
```

Or install globally:

```bash
npm install -g @agentis-hq/cli
agentis --help
```

With Bun:

```bash
bun x @agentis-hq/cli --help
```

## Backend URL

By default, the CLI talks to the hosted Agentis API:

```bash
https://api.agentis.systems
```

To point the CLI at a local or self-hosted backend:

```bash
AGENTIS_API_URL=http://localhost:3001 agentis agent list
```

## Authentication

Hosted wallets and hosted agents require an Agentis account key. The CLI gets one through the browser login flow and stores it in your OS keychain.

```bash
agentis login
agentis whoami
agentis logout
```

Local encrypted wallets do not require login.

## Wallets

Create a hosted wallet when logged in:

```bash
agentis wallet create --name my-agent
```

Create a local encrypted wallet:

```bash
agentis wallet create --name local-agent --local
```

List hosted and local wallets:

```bash
agentis wallet list
```

## Hosted Agents

List agents:

```bash
agentis agent list
```

Create a hosted agent:

```bash
agentis agent create research-agent
```

Create an agent in Quasar on-chain policy mode:

```bash
agentis agent create policy-agent --onchain-policy
```

Check balances:

```bash
agentis agent balance research-agent
```

Send SOL. Amount is lamports by default:

```bash
agentis agent send research-agent <recipient-wallet> 1000000
```

Send using SOL units:

```bash
agentis agent send research-agent <recipient-wallet> 0.01 --sol
```

## Paid Fetch

Fetch a URL and let Agentis automatically pay MPP or x402 payment requests through the selected hosted agent:

```bash
agentis fetch https://example.com/paid-data --agent research-agent
```

Use a different HTTP method:

```bash
agentis fetch https://example.com/paid-data --agent research-agent --method POST
```

## Policies

Read an agent or local wallet policy:

```bash
agentis policy get research-agent
```

Set limits:

```bash
agentis policy set research-agent --max-per-tx 1 --daily 10 --budget 100
```

Allow or remove domains:

```bash
agentis policy set research-agent --allow api.example.com
agentis policy set research-agent --disallow api.example.com
```

Stop or resume spending:

```bash
agentis policy set research-agent --kill
agentis policy set research-agent --resume
```

Initialize on-chain policy PDAs for an on-chain policy agent after funding the wallet:

```bash
agentis policy init-onchain policy-agent
```

## Jupiter Earn

Jupiter Earn support is mainnet-only. USDC amounts use UI units.

Deposit USDC into Jupiter Earn:

```bash
agentis earn deposit research-agent --asset USDC --amount 1 --mainnet
```

Show positions:

```bash
agentis earn positions research-agent --mainnet
agentis earn positions research-agent --mainnet --all
```

Sweep non-zero mainnet USDC balances across hosted agents into Jupiter Earn:

```bash
agentis earn sweep --dry-run
agentis earn sweep --no-dry-run
```

## Umbra Privacy

Umbra commands operate on hosted agent wallets.

Register an agent:

```bash
agentis privacy register --agent private-agent
```

Check status and encrypted balance:

```bash
agentis privacy status --agent private-agent
agentis privacy balance --agent private-agent
```

Deposit or withdraw encrypted balance:

```bash
agentis privacy deposit --agent private-agent --amount 1000000
agentis privacy withdraw --agent private-agent --amount 500000
```

Create and claim receiver-claimable UTXOs:

```bash
agentis privacy create-utxo --agent private-agent --to <receiver-wallet> --amount 1000000
agentis privacy scan --agent private-agent
agentis privacy claim-latest --agent private-agent
```

## Facilitators

Agentis can scaffold Kora-backed x402 facilitators and register them with the Agentis facilitator network.

Create a facilitator project:

```bash
agentis facilitator create my-facilitator
```

Create with custom settings:

```bash
agentis facilitator create my-facilitator --dir ./facilitator --fee-bps 500 --listed
```

List facilitators:

```bash
agentis facilitator list
```

Publish a public URL and optionally opt into discovery:

```bash
agentis facilitator publish my-facilitator --url https://facilitator.example.com --listed
```

## Command Help

Every command and subcommand supports `--help`:

```bash
agentis --help
agentis wallet create --help
agentis agent send --help
agentis fetch --help
agentis earn deposit --help
agentis privacy create-utxo --help
agentis facilitator publish --help
```

## Local Development

From the monorepo:

```bash
cd packages/cli
bun src/index.ts --help
```

Point at a local backend:

```bash
AGENTIS_API_URL=http://localhost:3001 bun src/index.ts agent list
```

## Notes

- Hosted agent keys are shown only when created or regenerated.
- CLI account keys are stored in the OS keychain.
- Local wallet vaults live under `~/.agentis/wallets/`.
- Jupiter Earn commands require mainnet and the `--mainnet` safety flag.
- Umbra devnet flows are currently safest with SOL or wSOL.

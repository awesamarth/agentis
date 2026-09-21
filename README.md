# Agentis

**Wallets, payments and spending controls for AI agents.**

Give each agent its own wallets, budget and on-chain identity. Let it pay for APIs, send funds and swap tokens—while you decide what it can spend and when it needs approval.

[Live dashboard](https://www.agentis.systems/dashboard) · [Public API](https://api.agentis.systems/health) · [Uniswap integration](#uniswap-integration) · [ENSv2 integration](#ensv2-integration) · [Developer feedback](FEEDBACK.md)

> **Testnet only.** The hosted dashboard and backend are deployed. The V2 CLI and SDK are published on npm, and the [agent skill](skills/agentis/SKILL.md) provides concise guidance for operating them.

## Why Agentis

An agent that can call an API should also be able to pay for it. But handing it an unrestricted private key is not a spending policy.

Agentis separates the owner's authority from the agent's credentials. The owner creates named agents, chooses networks, sets limits and enables optional plugins. The agent receives scoped access to request payments and use those capabilities—not permission to approve itself, rewrite its budget or export hosted keys.

One backend handles authorization, execution and receipts across the dashboard, SDK, CLI and remote MCP. Local-custody CLI wallets are also available for users who want keys to stay on their own machine.

## What you can do

| Capability | What it provides |
| --- | --- |
| **Independent agents** | Named agents with their own wallets, rules, enabled networks and plugins. |
| **Spending controls** | Per-transaction, rolling hourly/daily and lifetime USD caps shared across an agent's networks, including fees. Recipient restrictions, approval mode and pause controls. |
| **Payments** | Direct token transfers and paid GET requests through x402 or MPP, with recorded payment outcomes and HTTP responses. |
| **Uniswap** | Base Sepolia swaps, scheduled purchases, manual portfolio rebalancing, gas-refill schedules and optional x402 payment-token shortfall funding. |
| **ENS** | Owner-controlled ENSv2 subnames, network-specific payment addresses and narrowly delegated endpoint/description updates. ERC-8004 registration is part of this plugin. |
| **Dashboard** | Agent setup, balances, API keys, approval requests, transaction history and spend analytics. |
| **Agent interfaces** | TypeScript SDK, CLI and remote MCP with browser OAuth and explicit agent/network consent. |
| **Local custody** | Multichain CLI wallets, local spending policies, balances, transfers and paid fetches. No Privy account required for local custody. |

### Networks

| Network | Assets | Paid API support |
| --- | --- | --- |
| Base Sepolia | ETH, USDC | x402 |
| Ethereum Sepolia | ETH, USDC | x402; requires a Sepolia-enabled seller/facilitator |
| Arc Testnet | USDC | x402 |
| Tempo Testnet | alphaUSD | MPP |
| Solana Devnet | SOL, USDC | x402 |

Base is the default EVM network. ENSv2 identity writes use Ethereum Sepolia; Uniswap currently uses Base Sepolia only. Enabling a network does not automatically enable a plugin or expand an existing restricted credential.

## Get started

### Hosted agents

1. Sign in to the [dashboard](https://www.agentis.systems/dashboard).
2. Create an agent, choose its networks, set spending limits and select optional plugins.
3. Fund its wallets with the appropriate **testnet** assets, including gas where required.
4. Connect your agent through CLI browser login, remote MCP, or an API key from the agent's detail page.
5. Request a payment. In **ask** mode, the owner reviews and approves it in the dashboard. In **automatic** mode, eligible requests execute within the configured rules.

**Paused** agents cannot start new payments. Pausing cannot undo transactions already signed or submitted.

### CLI

Install with Bun (required on PATH), then connect your agents:

```sh
bun add -g @agentis-hq/cli@latest
agentis login
agentis wallet list --hosted
```

The CLI defaults to `https://api.agentis.systems`. The source examples below use `bun packages/cli/src/index.ts`; after installing, use `agentis` in its place.

Login opens owner consent for selected agents and networks. It stores scoped executor credentials locally, not an owner JWT. A previously saved login belongs to its original API URL; switching from a local development backend requires a new login.

```sh
# A hosted transfer. Set WALLET_ID and RECIPIENT to your chosen wallet/address.
bun packages/cli/src/index.ts wallet send --hosted \
  --wallet "$WALLET_ID" --chain base --asset USDC \
  --to "$RECIPIENT" --amount 0.01 --key invoice-001

# Pay an x402 seller, capped at 0.01 USDC in 6-decimal atomic units.
bun packages/cli/src/index.ts fetch https://your-seller.example/paid-data \
  --wallet "$WALLET_ID" --max-amount-atomic 10000 --key api-task-001

# Or create a separate local-custody wallet.
bun packages/cli/src/index.ts wallet create --local \
  --name local-agent --chains base,arc,tempo,solana,sepolia
```

Keep the same request key and terms when checking an uncertain payment. A new key means a new payment request. Local CLI keys are **plaintext, owner-permission-protected files**, not encrypted wallets.

### TypeScript SDK

Install `bun add @agentis-hq/sdk@^0.3.0` in an agent runtime or application backend:

```ts
import { AgentisClient } from '@agentis-hq/sdk'

const agentis = new AgentisClient({
  baseUrl: 'https://api.agentis.systems',
  token: process.env.AGENTIS_TOKEN!, // Scoped executor key, not an owner token.
})

const operation = await agentis.fetch({
  walletId: process.env.AGENTIS_WALLET_ID!,
  url: 'https://your-seller.example/paid-data',
  maxAmountAtomic: '10000',
}, { idempotencyKey: 'research-task-001' })

console.log(operation.status, operation.approvalUrl)
// After any required owner approval, inspect the same operation:
const current = await agentis.operations.get(operation.id)
console.log(current.status, current.receipt)
```

Approval-required is a normal asynchronous result, not a failed payment. `operations.wait()` can poll, but returns on approval-required, unknown or terminal states; it does not approve or resend. Keep executor keys out of browser bundles. See the [SDK implementation](packages/sdk/src/client.ts) for wallet, policy, operation, Uniswap and identity methods.

### Agent skill

Install the concise operating guide in a compatible agent harness:

```sh
bun x skills add awesamarth/agentis
```

The [skill](skills/agentis/SKILL.md) teaches command discovery, wallet selection, plugins and safe handling of approvals/retries—not unrestricted access to funds.

### Remote MCP

Connect an OAuth-capable remote MCP client to:

```text
https://api.agentis.systems/mcp
```

The owner signs in through the browser and explicitly selects agents and networks. Tools use the same backend rules as CLI/SDK requests. Restricted MCP credentials cannot approve payments, export keys or change policy. Uniswap and ENS tools are available according to enabled plugins.

No local stdio process or manually copied owner token is required. The actual external-client/browser-consent flow remains a verification item; see [MCP setup and protocol details](packages/mcp/README.md).

## Uniswap integration

Uniswap lets an agent acquire the token it needs rather than requiring the owner to pre-fund every payment asset. The per-agent plugin supports:

- **ETH ↔ USDC swaps:** exact-input or exact-output quotes with slippage and fee bounds.
- **Payment shortfalls:** opt into swapping only the missing USDC before a Base x402 payment.
- **DCA:** owner-confirmed recurring purchases, persisted and run by the backend worker.
- **Manual rebalancing:** preview and execute toward a saved ETH/USDC allocation target.
- **Gas refill:** scheduled USDC → ETH refills before gas falls below a threshold; not zero-gas rescue.

### How we use Uniswap

We query the **V3 Factory** for pools across four fee tiers, simulate quotes through **QuoterV2**, and construct bounded calls to **SwapRouter02**. Token allowances are exact-amount. Approval, swap and optional paid-fetch steps are persisted, and each signing step goes through Agentis's normal spending/approval pipeline. Settlement checks pool events and accounts for actual input plus fees.

This is a **direct Uniswap V3 contract integration**, not Trading API-generated calldata. It does not require a Uniswap API key. A successful swap cannot be rolled back if the subsequent paid API request fails.

### Contracts and code for reviewers

These are existing official **Base Sepolia** deployments, not custom Agentis contracts:

| Contract | Address |
| --- | --- |
| V3 Factory | [`0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`](https://sepolia.basescan.org/address/0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24) |
| QuoterV2 | [`0xC5290058841028F1614F3A6F0F5816cAd0df5E27`](https://sepolia.basescan.org/address/0xC5290058841028F1614F3A6F0F5816cAd0df5E27) |
| SwapRouter02 | [`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`](https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4) |

The following links pin the implementation revision so line references remain stable:

| Integration point | Relevant code |
| --- | --- |
| Deployed addresses, quotes, bounds and calldata | [`plugins/uniswap/swap.ts`](apps/backend/src/plugins/uniswap/swap.ts) |
| Persisted execution and x402 shortfall funding | [`plugins/uniswap/service.ts`](apps/backend/src/plugins/uniswap/service.ts) |
| DCA, rebalancing and gas-refill worker | [`UniswapService`](apps/backend/src/plugins/uniswap/service.ts) |
| On-chain allowance/swap receipt verification | [`privy-executor.ts`, lines 140–160](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/providers/privy-executor.ts#L140-L160) |

**Live proof:** an owner-approved Privy transaction swapped **0.000001 ETH → 0.00326 USDC** on Base Sepolia. [View transaction](https://sepolia.basescan.org/tx/0x8c740f96a453072a4e31273858874cacc05377d649d190f0e5af7ecfe4012f99).

**Feedback:** [FEEDBACK.md](FEEDBACK.md). The project author has completed the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).

Tempo testnet `42431` was unavailable through the Trading API; its supported Tempo network was `4217`. We did not switch to mainnet. Tempo MPP payments work independently, but Uniswap-backed MPP auto-funding is not implemented. See [the integration walkthrough](docs/uniswap.md) for execution details and verification boundaries.

## ENSv2 integration

An agent's identity should describe **where to pay it, where to reach it and what it can change**—not just give it a display name.

The ENS plugin builds this on **ENSv2 on Ethereum Sepolia**, using hierarchical registries and the permissioned resolver:

1. **Owner-controlled hierarchy.** The owner supplies a real ENSv2 parent name, creates or attaches an official user subregistry, and registers an agent subname. The owner retains namespace ownership.
2. **Multichain payment records.** Setup publishes the agent's enabled wallet addresses using network-specific EVM coin types and Solana's coin type. Payment requests resolve the selected network's explicit record, then bind the resolved address into the operation reviewed for approval. Missing records fail rather than falling back to another chain's address.
3. **Narrow delegation.** The owner grants the agent permission to update only its own service endpoint and description. Payment addresses, ownership and other names are not delegated. The owner can revoke either text permission on-chain.
4. **Execution-time checks.** Agent record updates use the normal budget/approval/signing pipeline. Before signing, Agentis rechecks namespace ownership, agent binding and the live resolver permission.
5. **Portable registration.** ERC-8004 registration and its document are linked back to the ENS name through ENSIP-25. ERC-8004 is internal to the **single ENS plugin**, not a separate plugin or a reputation claim.

Namespace transactions require the external namespace owner's signature. Agent operations use the hosted wallet's usual authorization flow. ENS identity does not bypass spending rules.

### Contracts and code for reviewers

| Ethereum Sepolia deployment | Address |
| --- | --- |
| ENSv2 ETHRegistry | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| VerifiableFactory | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` |
| UserRegistry implementation | `0x624a25d67b59d587752ebec8dded8827dae52050` |
| PermissionedResolver implementation | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

| Integration point | Relevant code |
| --- | --- |
| ENSv2 contracts, parent inspection and permission checks | [`ens/contracts.ts`, lines 6–59](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/plugins/ens/contracts.ts#L6-L59) |
| Dynamic registry/subname setup, wallet records and text delegation | [`EnsService.next`, lines 55–104](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/plugins/ens/service.ts#L55-L104) |
| Owner revoke/grant and signing-time revalidation | [`ens/service.ts`, lines 123–151](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/plugins/ens/service.ts#L123-L151) |
| Explicit network-address resolution | [`ens/resolution.ts`](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/plugins/ens/resolution.ts#L7) |
| Binding resolved names into payment requests | [`operations.ts`, lines 134–148](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/operations.ts#L134-L148) |
| ERC-8004 document and ENSIP-25 association key | [`ens/erc8004.ts`](https://github.com/awesamarth/agentis/blob/3ea00397df8a80a83b5433b96bd1c2cd35378814/apps/backend/src/plugins/ens/erc8004.ts#L5-L30) |

### Functional demo

Open an agent in the [live dashboard](https://www.agentis.systems/dashboard), enable **ENS**, and use an ENSv2 parent name you own on Sepolia. Setup reads current chain state and prepares the missing transactions; it does not return hard-coded agent identities or balances.

Our existing demo agent is **`research.awesamarth.eth`**, registered under **`awesamarth.eth`**, with ERC-8004 identity **#10257**. These are live example records, not required names for other users.

- [Resolve the demo agent's Base address through the public API](https://api.agentis.systems/v1/ens/resolve?name=research.awesamarth.eth&chainId=eip155%3A84532).
- [Subname registration transaction](https://sepolia.etherscan.io/tx/0x46d8ead8271e0e7826848c47823c4a7a56145594386ca89fc55859359c15683a).
- [Wallet-record publication and text delegation](https://sepolia.etherscan.io/tx/0xd22e973f7b87c06fa190b8a19967c5e651704f57eb66ccfc662a0c67170ac4ad).
- [Owner endpoint-permission revocation](https://sepolia.etherscan.io/tx/0xfe0f700435d4b48b20618ec22b8c73c0deeba87b251cebaf2e8b2b3f53ccb749) and [restoration](https://sepolia.etherscan.io/tx/0x031b5e7330a86eb217a0f00ccb1f24582268d6fa95e32b1cd168f8aab60746cf).
- [ERC-8004 registration](https://sepolia.etherscan.io/tx/0x279dc164a7b959b396eeb39d9ffed7e0a4d76d52ddabe999be23ad015e34f26e) and [finalized registration document](https://sepolia.etherscan.io/tx/0x3a64b6ad4943f9a3d916b57e1fd0b2505845ecba49a0a4bf2a7739b62866f6a7).

The ENSIP-25 association was read back on-chain. Revoked endpoint writes, writes to another subname and protected address writes reverted in simulation; these negative checks were not submitted transactions.

## Execution and security model

```text
Authenticate → validate request → reserve budget → approve / authorize
             → Privy execution → chain reconciliation → ledger + receipt
```

- **Hosted custody:** Privy holds the wallet keys. New hosted wallets use a 1-of-2 owner quorum: the user and server authorization key. Either quorum member can authorize independently; spending restrictions are enforced by Agentis's backend, not an independent provider-enforced policy.
- **Scoped credentials:** executor keys and MCP grants are agent- or wallet-scoped. They cannot approve themselves, change policy or export keys. Hosted export is an explicit owner-authenticated action.
- **Money accounting:** bigint atomic amounts, decimal-string JSON, fresh server prices and transactional fee-inclusive reservations. Zero caps block spending; blank caps are unlimited. Failed transactions charge actual fees, not the requested transfer amount.
- **Uncertain execution:** signed bytes/hash are persisted before broadcast. Unknown submissions retain reservations and reconcile; a timeout is not permission to create another payment.
- **Local custody:** the CLI enforces its own wallet-wide ledger and rules. This is local software enforcement, not hosted security or protection against someone who controls the machine/private key.

This is testnet software, not an audited mainnet custody product. Rate limiting, webhook delivery and permanently unknown-submission recovery remain follow-up work. Umbra, Jupiter Earn and the former Quasar enforcement are not part of this V2 implementation.

## Run locally

Requires **Bun 1.3.14**, Docker/Postgres, and Privy credentials for hosted execution.

```sh
bun install --frozen-lockfile
bun run build:packages
docker compose -p agentis-rewrite up -d --wait
cp apps/backend/.env.example apps/backend/.env
# Configure the private backend environment before continuing.
cd apps/backend
bun run db:migrate
bun run index.ts
# Another terminal, from apps/backend with the same environment:
bun run worker
```

For hosted execution, configure `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, the server authorization key and `AGENTIS_EXECUTOR=privy`. Execution defaults to disabled. Set `DASHBOARD_URL`, `AGENTIS_PUBLIC_API_URL` and the database URL for your environment. The example uses a separate local Postgres instance on port **55432**.

Start the frontend from `apps/next-app` with `bun dev`; set `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001` in its private environment.

Use a **separate development database and test wallets**. Do not run a stale local copy of production wallet/operation data alongside the production executor. Never commit environment files, wallet keys or signed-transaction journals.

Validation: `bun run check` builds the packages and typechecks the backend/interfaces/dashboard. Use targeted lint or an existing relevant check for smaller changes.

## Repository map

| Directory | Purpose |
| --- | --- |
| [`apps/backend`](apps/backend) | Hono API, Postgres schema/migrations, execution, reconciliation and plugins |
| [`apps/next-app`](apps/next-app) | Next.js dashboard and owner approval/consent flows |
| [`packages/core`](packages/core) | Shared operation schemas and types |
| [`packages/sdk`](packages/sdk) | TypeScript client |
| [`packages/cli`](packages/cli) | Hosted and local-custody commands |
| [`packages/mcp`](packages/mcp) | Remote MCP tools used by the backend |
| [`skills/agentis`](skills/agentis) | Concise V2 agent skill: discovery, payments, plugins and safety |

### Verification status

Real testnet transfers and paid requests have exercised the hosted and local payment paths. The deployed production API/owner-approval/worker flow also confirmed an [Arc USDC transfer](https://testnet.arcscan.app/tx/0x3f8060f64c397eb7e585e2167ee2f5ca10507c26fd29a3091252bff103b90142). Uniswap and ENS live evidence is linked above.

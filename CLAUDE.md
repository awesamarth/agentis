# Agentis — Project Handover Document

## Overview
Agentis is a full-stack agentic crypto infrastructure suite built on Solana. The vision is to own the entire stack that AI agents need to transact autonomously on-chain — wallets, payments, policies, privacy, token swaps, and identity — all composable, all developer-friendly.

Think "AWS for AI agents on Solana." Every layer an agent needs to operate financially is provided by Agentis.

---

## The Builder
- Solo developer, full time on this
- Background: Ethereum full-stack dev — Solidity, Foundry, Hardhat, TypeScript, Next.js, Bun
- Solana experience: beginner, learning as we go
- Framework choice: **Quasar** (not Anchor) for on-chain programs — it's a new zero-copy Solana program framework by Blueshift, Anchor-like syntax but near-native CU efficiency. Beta but stable enough.

---

## Competition Context
- **Hackathon:** Solana Frontier Hackathon 2026 by Colosseum
- **Dates:** April 6 – May 11, 2026 (submissions due May 11)
- **Prize:** $30k Grand Champion, $10k each for top 20, top 10 get into Colosseum accelerator with $250k pre-seed
- **Nature:** This is a startup competition, not a traditional hackathon. Existing startups compete. The bar is "would a VC fund this." Build accordingly.
- **Strategy:** Not everything needs to be complete by May 11 — but what IS built needs to be polished, and the vision + roadmap needs to be fundable and believable.
- **Note:** Colosseum removed all named tracks/bounties — it's one unified competition. The "Umbra Track ($10k)" mentioned earlier is NOT confirmed. Verify on Superteam Earn before counting on it.

---

## Sidetracks We're Targeting
1. **Jupiter Track** — Facilitator layer using Jupiter Swap + Jupiter Earn is an unintended use of Jupiter APIs. Document dev experience honestly.
2. **100xDevs Track** — No constraints, just best product on Solana. Apply regardless.
3. **Umbra integration** — Build it as a core layer regardless of prize track. Enterprise selling point.

---

## What We're Building — The Agentis Suite

### Vision
Any developer building an AI agent should be able to plug into Agentis and get:
- A wallet for their agent
- Payment rails (MPP/x402)
- Policy enforcement (spending limits, domain whitelists, kill switches)
- Private transactions (via Umbra)
- Automatic token conversion (via Jupiter Swap)
- Passive yield on idle funds (via Jupiter Earn)
- On-chain identity and registry

### The Stack

#### 1. Agentis SDK (TypeScript/Bun)
The runtime layer. Developers import this into their agent's codebase. It sits between the AI agent and the internet.

- `agent.fetch()` replaces native `fetch()` — automatically handles 402 MPP/x402 payment flows
- Policy enforcement before every payment (checks on-chain Quasar program + local config)
- Silent Jupiter swap if agent holds wrong token for a payment
- Jupiter Earn integration — idle funds earn yield automatically
- Umbra integration for private payments
- Works with any AI framework (Claude, GPT, etc.)
- Initialized with an API key from the Agentis Dashboard

**SDK usage pattern:**
```typescript
import { AgentisClient } from '@agentis/sdk'
import Anthropic from '@anthropic-ai/sdk'

const agentis = await AgentisClient.create({
  apiKey: 'agt_live_xxxx',  // from Agentis Dashboard
  agentId: 'agent_xyz',
  privacy: true,
})
const claude = new Anthropic()

const response = await claude.messages.create({
  model: 'claude-opus-4-6',
  tools: [{ name: 'fetch_paid_data', ... }],
  messages: [{ role: 'user', content: 'Get latest Solana DEX volume from Dune' }]
})

if (response.stop_reason === 'tool_use') {
  const tool = response.content.find(b => b.type === 'tool_use')
  const data = await agentis.fetch(tool.input.url) // SDK handles payment silently
}
```

#### 2. Agentis CLI
For developers managing agents from terminal. Auth via `agentis login` which opens browser popup (Privy login), then stores a **session token** in `~/.agentis/config.json`.

- `agentis login` — browser-based auth (opens agentis.xyz/auth/cli?token=<state>), polls for completion, stores session token locally
- `agentis wallet create` — spin up an agent wallet (local or cloud)
- `agentis wallet list` — list all agents (cloud wallets fetched from Agentis backend)
- `agentis policy set --max-spend 0.1 --domains xyz.com,abc.com`
- `agentis simulate` — test payment flows locally
- `agentis sync` — sync local agent names/config to cloud
- `agentis deploy` — deploy on-chain policy programs

**CLI login flow:**
1. `agentis login` → CLI calls `GET /auth/cli/init` → gets state token + browser URL
2. Opens browser → user logs in via Privy on `agentis.xyz/auth/cli?token=<state>`
3. CLI polls `GET /auth/cli/poll?state=xxx` every 2 seconds
4. On success → receives session token → stored in `~/.agentis/config.json`
5. All CLI commands send this token as `Authorization: Bearer <session-token>` — backend identifies the user from it

**Important:** CLI session token ≠ agent API key. Session token = who you are (user identity). API key = which agent wallet to use (per-agent credential for SDK).

#### 3. Agentis Dashboard (Next.js 16, Tailwind v4, Bun)
Web UI for managing agents. Auth via Privy (Google/wallet). Target: less technical users and businesses.

- Visual policy builder (spend limits, domain whitelists, kill switches)
- Agent wallet overview, top-up, spending history + analytics
- Emergency kill switch per agent
- Team management (multiple agents per org)
- API key generation per agent (used by SDK)
- Publicly searchable registry of MPP/x402 endpoints
- One-line server-side MPP/x402 integration: `agentisify(app)`

**Design system:**
- Fonts: Playfair Display (serif, headings, weight 700/900), DM Mono (monospace, technical text/labels), DM Sans (body, weight 300)
- Colors: beige (#f5f0e8), black (#0f0e0c), ink (#2a2620), ink-muted (#6b6459), beige-darker (#d9d0be)
- Use Tailwind v4 classes exclusively — no inline styles except `clamp()` for fluid font sizes
- All custom colors defined via `@theme` in globals.css

#### 4. On-Chain Programs (Quasar)
- Agent identity registry (PDA per agent)
- Kill switch flag (the one policy that must be trustless)
- Spend counters for rate limiting verification
- Policy hash (full policy off-chain, hash on-chain for verifiability)

**Note on policy storage:** Full policy rules stored off-chain in Agentis DB (encrypted). On-chain stores only the kill switch, spend counters, and a policy commitment hash. Tx fees on Solana are ~$0.001 so on-chain updates are not a cost concern.

#### 5. Facilitator Service
- Jupiter Swap: agent holds SOL, endpoint needs USDC → swap silently, pay, done
- Jupiter Earn: idle agent funds deposited automatically, withdrawn on demand before payments
- Runs as a microservice called by the SDK
- Umbra wraps this layer for privacy

#### 6. MCP Server
For AI agents that can't run shell commands (no terminal access). Exposes same Agentis functionality as MCP tools. Distribution channel — makes Agentis discoverable in MCP ecosystem.

#### 7. Skill (Claude Code / Cursor compatible)
SKILL.md file. Almost free to build once MCP server exists.

---

## Monorepo Structure

```
agentis/
  apps/
    next-app/       ← Dashboard (Next.js 16, Tailwind v4, Bun)
    backend/        ← Hono API server (Bun, port 3001)
  packages/
    core/
    sdk/
    cli/
    mcp/
```

---

## What's Been Built So Far

### Dashboard (`apps/next-app`)
- Landing page (`/`) with Privy auth (Google, GitHub, Phantom/Solana wallets)
- Dashboard page (`/dashboard`) — lists agents, create agent modal
- Shared `Navbar` component (`components/Navbar.tsx`)
- Privy configured with `toSolanaWalletConnectors()`, `walletChainType: 'solana-only'`, Solana embedded wallet created on login
- `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001` in `.env.local`

### Backend (`apps/backend`)
- Hono server on port 3001
- `GET /agents` — list agents for authenticated user
- `POST /agents` — create agent: calls `privy.walletApi.create({ chainType: 'solana' })`, generates `agt_live_xxx` API key, stores in JSON DB
- Auth middleware: verifies Privy JWT (`privy.verifyAuthToken`) to identify user
- JSON file DB at `apps/backend/data/db.json` (temporary, for testing only)
- Privy server-auth SDK: use `privy.walletApi.create()` NOT `privy.wallets()` (that doesn't exist in this version)

### Agent data model:
```typescript
{
  id: string          // uuid
  name: string        // user-provided
  userId: string      // Privy user ID
  walletId: string    // Privy wallet ID (for signing)
  walletAddress: string // Solana pubkey
  apiKey: string      // agt_live_xxx (shown once to user)
  createdAt: string
}
```

---

## Auth Architecture

**Three credential types — keep these distinct:**

| Credential | Who uses it | What it is |
|---|---|---|
| Privy JWT | Dashboard frontend | Short-lived token Privy issues on login, verified via `privy.verifyAuthToken()` |
| CLI session token | CLI commands | Session token stored in `~/.agentis/config.json` after `agentis login` |
| Agent API key (`agt_live_xxx`) | SDK / agent code | Per-agent credential, identifies which wallet to use |

**Trust chain:**
```
SDK (dev's server) → Agentis API (validates API key) → Privy (signs tx via server wallet)
Dashboard → Agentis API (validates Privy JWT) → Privy (signs tx)
CLI → Agentis API (validates session token) → Privy (signs tx)
```

**Backend auth middleware — future state (not yet built):**
- If `Bearer agt_live_xxx` → API key auth → look up in DB, find agent + user
- If `Bearer <privy-jwt>` → call `privy.verifyAuthToken()` → get userId
- If `Bearer <session-token>` → CLI token lookup → get userId

---

## API Key Security (Production)
- Currently: API keys stored in plaintext in JSON DB (fine for testing)
- Production: hash with SHA-256 before storing, show plaintext only once at creation
- Pattern: same as GitHub/Stripe tokens — hash stored, plaintext never again

---

## Wallet Architecture

**Two tiers:**

| | Local Mode | Managed Mode |
|---|---|---|
| Wallet | Local keypair (`~/.agentis/wallets/`) | Privy server wallet (HSM-backed) |
| Policies | Local config file | Off-chain DB + on-chain commitment |
| Auth | None needed | Agentis API key |
| Target user | Developers / power users | Businesses / non-technical |

**Privy server wallets** — your backend owns the authorization key, calls `privy.walletApi` to sign transactions. Keys never leave Privy's HSM. User never sees Privy.

---

## Payment Protocol — MPP (Machine Payments Protocol)

**What is MPP?**
- Co-authored by Stripe and Tempo, launched early 2026
- Open standard for machine-to-machine payments over HTTP
- Built on HTTP 402 "Payment Required" status code
- Payment-rail agnostic: stablecoins (USDC), credit cards (Stripe), Lightning
- Native session model for high-frequency micropayments
- Backwards compatible with x402

**How it works:**
1. Agent sends HTTP request to paid endpoint
2. Server returns 402 with price + accepted payment methods
3. Agent's wallet signs a payment credential
4. Agent retries with credential as HTTP header
5. Server verifies, settles, delivers resource + receipt

**Key partners on MPP:** OpenAI, Anthropic, Google Maps, Gemini, Dune, Modal, fal.ai, Browserbase.

**Important:** Privy was acquired by Stripe in 2025. Stripe co-authored MPP. Privy will eventually build MPP-native agent wallets. Agentis needs to move fast and establish on-chain + Solana-native differentiation.

---

## Policy Engine

Like AWS IAM for AI agents. Enforced at two layers:
- **Off-chain (SDK):** Checks before any payment attempt
- **On-chain (Quasar):** Kill switch + spend counters (trustless guarantees)

Policy rules:
- Max spend per day/week/month
- Domain whitelist
- Token restrictions
- Kill switch (on-chain, instant)
- Require human approval above threshold

**Competitive differentiation vs Privy:** Privy's policy engine is off-chain, enforced in their enclave. Agentis has on-chain enforcement (trustless) + MPP/x402 semantic awareness + privacy via Umbra + token abstraction via Jupiter. Privy is wallet infra; Agentis is the full agent financial OS.

---

## Privacy Layer — Umbra Integration

**Install:** `npm install @umbra-privacy/sdk @umbra-privacy/web-zk-prover`

**Two privacy layers:**
- ETAs (Encrypted Token Accounts) — balance is ciphertext, fast, no ZK needed
- Mixer pool — full unlinkability via ZK proofs, 1-3s proof generation in Node

**Supported tokens (mainnet):** USDC, USDT, wSOL, UMBRA — Jupiter facilitator must settle in one of these.

**Privy + Umbra integration — NO private key export needed.**
Umbra requires `IUmbraSigner` interface: `{ address, signTransaction, signTransactions, signMessage }`. These are all standard Ed25519 Solana operations that Privy supports natively via `privy.walletApi.solana.*`. Build a thin wrapper:
```typescript
const umbraSigner: IUmbraSigner = {
  address: walletAddress,
  signMessage: (msg) => privy.walletApi.solana.signMessage({ walletId, message: msg }),
  signTransaction: (tx) => privy.walletApi.solana.signTransaction({ walletId, transaction: tx }),
  signTransactions: (txs) => Promise.all(txs.map(tx => privy.walletApi.solana.signTransaction({ walletId, transaction: tx }))),
}
```
Umbra's internal key hierarchy (MVK, X25519, ZK keys) is derived from a `signMessage` call on `UMBRA_MESSAGE_TO_SIGN` — standard signing, no special scheme.

**Compliance:** Hierarchical viewing keys (per-mint, per-year, per-month, per-day). Enterprise killer feature — prove tx happened without revealing details publicly.

**Gotchas:**
- ETAs don't hide ownership, only balance amounts
- ZK proof = 1-3s latency — use ETA-only path for high-frequency MPP micropayments
- Arcium MPC dependency for encrypted compute (not purely on-chain)
- Mandatory auditor registration before first private transfer — factor into agent onboarding

---

## Facilitator / Token Swap Layer — Jupiter

**Jupiter APIs available:**
- Swap V2 (`/swap/v2/order` + `/swap/v2/execute`) — main swap
- Trigger (`/trigger/v2/orders/price`) — limit orders
- Recurring (`/recurring/v1/createOrder`) — DCA
- Lend (`/lend/v1/earn/deposit`) — Jupiter Earn / yield
- Price (`/price/v3`) — oracle
- Portfolio (`/portfolio/v1/positions`) — agent balance tracking

**Jupiter is pure REST — no SDK needed.** All APIs are HTTP calls, no RPC node required, clean JSON responses.

**Swap flow (with Privy):**
1. `GET /swap/v2/order?inputMint=SOL&outputMint=USDC&amount=xxx&taker=<wallet_address>` → get unsigned transaction
2. Sign via `privy.walletApi.solana.signTransaction()` → signed transaction
3. `POST /swap/v2/execute` with signed transaction → Jupiter lands it

**Earn flow:**
1. `POST /lend/v1/earn/deposit` → get unsigned transaction
2. Sign via Privy → submit

Jupiter + Privy are perfectly compatible. Jupiter builds transactions, Privy signs them. Private keys never leave Privy's HSM.

**Agentis facilitator logic:**
1. Check what token endpoint accepts (from MPP 402 response)
2. If agent holds that token → pay directly
3. If not → Jupiter Swap silently, then pay
4. Idle funds → Jupiter Lend (Earn), auto-withdraw before payments

**Jupiter also has an MCP server** — Agentis MCP should position on top of it, adding policy + payment handling that Jupiter's MCP lacks.

---

## Tech Stack
- **On-chain:** Quasar (Solana, zero-copy, Anchor-like syntax, beta)
- **SDK/CLI:** TypeScript, Bun
- **Dashboard:** Next.js 16, Tailwind v4, Bun
- **Backend:** Hono (Bun runtime)
- **Auth:** Privy (Google/wallet for dashboard + CLI browser login)
- **Wallet Infra:** Privy server wallets (`privy.walletApi.create()`)
- **Payment Protocol:** MPP + x402 compatible
- **Swap/Yield:** Jupiter Swap + Jupiter Earn
- **Privacy:** Umbra SDK

---

## Local Reference Files
- `JUPITER.txt` — Full Jupiter API documentation (llms.txt format). Read this before working on facilitator/swap layer.
- `UMBRA.txt` — Full Umbra SDK documentation. Read this before working on privacy layer.
- Privy MCP server is configured in `.mcp.json` — use `mcp__privy-docs__search_privy_docs` and `mcp__privy-docs__query_docs_filesystem_privy_docs` tools to query Privy docs directly in conversation.
- MPP MCP server is configured in `.claude.json` — use `mcp__mpp__search_docs`, `mcp__mpp__read_page`, `mcp__mpp__list_pages` etc. to query MPP docs directly in conversation.

---

## Key Resources
- MPP Docs: https://mpp.dev/overview
- Stripe MPP Docs: https://docs.stripe.com/payments/machine/mpp
- x402: https://www.x402.org/
- Quasar Docs: https://quasar-lang.com/docs
- Quasar GitHub: https://github.com/blueshift-gg/quasar
- Umbra Docs: https://docs.umbraprivacy.com
- Umbra SDK: https://sdk.umbraprivacy.com
- Umbra SDK full API: https://sdk.umbraprivacy.com/llms.txt
- Jupiter Docs: https://dev.jup.ag
- Jupiter MCP: https://dev.jup.ag/mcp
- Privy Docs: https://docs.privy.io (MCP server added to project)
- Colosseum Frontier: https://colosseum.com/frontier
- MPP + Cloudflare: https://developers.cloudflare.com/agents/agentic-payments/mpp/

---

## What Still Needs Building (Priority Order)

### Immediate next steps:
1. **Dashboard — agent detail page** — view wallet address, copy API key (regenerate option), policy settings, kill switch
2. **CLI** — `agentis login` browser flow, `agentis wallet list`, `agentis agent create`
3. **Quasar programs** — agent registry PDA, kill switch, spend counters
4. **SDK** — `AgentisClient.create()`, `agentis.fetch()` with MPP/x402 flow
5. **Facilitator** — Jupiter swap + earn integration

### Later:
- MCP server
- Skill (SKILL.md)
- Umbra private payments integration
- Replace JSON DB with real DB (Postgres/SQLite)
- Hash API keys before storing (SHA-256, show plaintext once)
- CLI session token auth in backend middleware

---

## Tone / Working Style Notes
- Builder is direct, no glazing, no hand-holding
- Hinglish is fine in conversation
- Be honest about tradeoffs, push back when something doesn't make sense
- Concise > verbose
- Think like a co-founder, not an assistant
- This is a fundraising demo targeting $250k pre-seed accelerator — build and advise accordingly, not like a hackathon toy

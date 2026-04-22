# Agentis — Project Handover Document

## Overview
Agentis is **"The complete financial infrastructure for AI agents on Solana."** — wallets, MPP/x402 payments, policy engine, privacy (Umbra), token swaps (Jupiter), yield (Jupiter Earn), on-chain identity. Think AWS for AI agent finance.

---

## The Builder
- Solo dev, full time. Background: Ethereum (Solidity, Foundry, TS, Next.js, Bun). Solana beginner.
- On-chain framework: **Quasar** (not Anchor) — zero-copy, Anchor-like syntax, by Blueshift. Beta but stable.
- Direct, no glazing. Hinglish fine. Think co-founder, not assistant. This is a $250k pre-seed fundraising demo.

## Competition
- **Solana Frontier Hackathon 2026** by Colosseum. Submissions due May 11, 2026.
- $30k Grand Champion, $10k top 20, top 10 → Colosseum accelerator ($250k pre-seed). Startup competition, not a toy hackathon.
- Jupiter Track + 100xDevs Track also targeted.

---

## Monorepo Structure
```
agentis/
  apps/
    next-app/     ← Dashboard (Next.js 16, Tailwind v4, Bun), port 3000
    backend/      ← Hono API (Bun), port 3001
  packages/
    core/         ← @agentis/core — shared types, policy engine
    sdk/          ← @agentis/sdk — AgentisClient
    cli/          ← NOT BUILT YET
    mcp/          ← NOT BUILT YET
  sdk-testing/
    x402-server/  ← Test x402 server (Hono + PayAI + ExactSvmScheme), port 4000
    mpp-server/   ← Test MPP server (@solana/mpp/server), port 4001
    agent-app/    ← Test script using AgentisClient
```

`packages/core` and `packages/sdk` exports point to `src/` directly — no build step needed locally.

---

## What's Built & Working

### SDK (`packages/sdk`) ✅
- `AgentisClient.create({ apiKey, baseUrl })` — bootstraps from backend, seeds spend history
- `agentis.fetch(url)` — drop-in fetch replacement. Detects 402, identifies MPP vs x402, enforces policy, proxies payment through backend
- **MPP flow:** backend uses `createSolanaKitSigner` from `@privy-io/node/solana-kit` + `broadcast: true` — WORKING on devnet
- **x402 flow:** backend uses `createX402Client` from `@privy-io/node/x402` + `wrapFetchWithPayment` from `@x402/fetch` — WORKING on devnet with real USDC
- Policy enforcement before every payment (USD amounts, not SOL)
- Both flows record transactions to DB after successful payment

### Backend (`apps/backend`) ✅
Entry: `apps/backend/index.ts`. Env in `apps/backend/.env`.

**Routes:**
- `/agents/*` — CRUD, Privy JWT auth. Create agent (Privy wallet + `agt_live_xxx` key), PATCH policy, send SOL, regen key, transactions
- `/sdk/*` — API key auth (`x-api-key: agt_live_xxx`). `GET /sdk/agent`, `PATCH /sdk/agent/policy`, `POST /sdk/agent/fetch-paid` (x402), `POST /sdk/agent/fetch-paid-mpp` (MPP), `POST /sdk/agent/record-spend`
- `/account/*` — account-level keys (`agt_user_xxx`) for CLI/MCP
- `GET /sol-price` — returns current SOL/USD price (Jupiter Price API v3, cached 60s in memory)

**DB:** JSON file at `apps/backend/data/db.json` (gitignored, temporary).

**`apps/backend/src/lib/price.ts`** — `getTokenPriceUsd(mint)`, `solToUsd(sol)`. Stablecoins hardcoded at $1 (USDC mainnet/devnet, USDT, USDG). SOL cached 60s via Jupiter `/price/v3`.

### Dashboard (`apps/next-app`) ✅
- `/` — landing page, Privy auth
- `/dashboard` — agent list, create modal. Guest mode (localStorage, real devnet keypairs via `gill`)
- `/dashboard/agents/[id]` — wallet, SOL balance, token balances, kill switch, spending limits (USD), domain whitelist, API key display/regen, tx history
- `/dashboard/agents/[id]/test` — send SOL test console
- `/dashboard/profile` — identity, stats, spend charts (USD), account API key

**Design:** Playfair Display (headings), DM Mono (technical), DM Sans (body). Colors: beige (#f5f0e8), black (#0f0e0c), ink (#2a2620), ink-muted (#6b6459), beige-darker (#d9d0be). Tailwind v4 only, no inline styles except `clamp()`.

### Policy Engine (`packages/core/src/policy.ts`) ✅
All amounts in **USD** (not SOL). Policy limits are USD. `checkPolicy(policy, amountUsd, url, history)`.
- Kill switch, domain whitelist, maxPerTx, hourly/daily/monthly/maxBudget limits
- SDK fetches SOL price from `/sol-price` before checking, converts SOL→USD
- Stablecoins (USDC/USDT/USDG) skip price conversion — already USD

### Data Model
```typescript
// Agent (in DB)
{ id, name, userId, walletId, walletAddress, apiKey, createdAt,
  policy?: { hourlyLimit, dailyLimit, monthlyLimit, maxBudget, maxPerTx, allowedDomains, killSwitch },
  transactions: TxRecord[], monthSpend: { month: string, spend: number } }

// TxRecord
{ txHash, amount: number (SOL), amountUsd: number (USD), recipient, timestamp }

// SpendRecord (in-memory SDK)
{ amount: number (USD), timestamp, url }
```

---

## Critical Gotchas — Read These

### MPP
- **Use `createSolanaKitSigner` from `@privy-io/node/solana-kit`** — NOT manual transaction signing, NOT `privy.walletApi.solana.signTransaction`
- **Always `broadcast: true`** on `solanaClient.charge()` — pull mode (server broadcast) fails with "Blockhash not found"
- MPP server returns `payment-receipt` header with `{ method, reference (= tx sig), status, timestamp }`
- MPP 402 response: `WWW-Authenticate: Payment id="...", realm="...", method="solana", intent="charge", request="<base64url>"`
- Detect MPP: `/^Payment\s+id=/i.test(wwwAuth)`

### x402
- **Use `createX402Client` from `@privy-io/node/x402`** — NOT `ExactSvmSchemeV1` with manual Privy signer (format mismatch)
- x402 v2 uses `PAYMENT-REQUIRED` header (base64 JSON), NOT body JSON
- x402 server returns `payment-response` header (not `payment-receipt`) with `{ success, payer, transaction (= tx sig), network }`
- `PAY_TO` address must have an existing USDC ATA on devnet. Burn address (`5yDpyuSo...`) has NO ATA — don't use as PAY_TO
- PayAI facilitator pays gas — client doesn't need SOL for fees
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle faucet)

### x402 vs MPP amount parsing
- x402 `amount` field = atomic token units (USDC 6 decimals: 1000 = $0.001). It is NOT SOL.
- Check `requirements.asset` mint to determine token — stablecoins = already USD, SOL mint = convert via price API
- SOL mint: `So11111111111111111111111111111111111111112`

### Privy
- Use `@privy-io/node` (not `@privy-io/server-auth`) for MPP/x402 signing
- `@privy-io/server-auth` is only for JWT verification (`privy.verifyAuthToken`)
- Run backend from `apps/backend/` directory so `.env` is picked up

### General
- `solana-kite` removed — had `fs/promises` incompatibility with Turbopack. Use raw RPC fetch for balance.
- Jupiter Portfolio API is mainnet-only — token balances empty on devnet. SOL balance works fine.
- Running 3 Bun processes simultaneously may cause OOM. Start servers one at a time if issues arise.
- All spend amounts throughout the system are in **USD**. SOL amounts only stored for raw chain record.

---

## Auth Architecture

| Credential | Used by | What it is |
|---|---|---|
| Privy JWT | Dashboard | Short-lived, verified via `privy.verifyAuthToken()` |
| CLI session token | CLI | Stored in `~/.agentis/config.json` after login |
| `agt_live_xxx` | SDK | Per-agent API key |
| `agt_user_xxx` | CLI/MCP | Account-level key |

---

## Payment Protocols

### MPP (Machine Payments Protocol)
Co-authored by Stripe + Tempo, 2026. Open standard, HTTP 402-based, token-agnostic.
Key partners: OpenAI, Anthropic, Google Maps, Dune, Modal, fal.ai.
```
Client → GET /resource
Server → 402 + WWW-Authenticate: Payment id="...", request="<base64url>"
Client → Signs challenge, retries with Authorization: Payment <credential>
Server → Verifies, 200 + payment-receipt header
```

### x402 (v2)
```
Client → GET /resource
Server → 402 + PAYMENT-REQUIRED: <base64 JSON with accepts[]>
Client → Signs USDC SPL transfer tx (not broadcast)
Client → Retries with X-Payment: <base64 payload>
Server → PayAI /verify → /settle (broadcasts, pays gas) → 200
```

### SDK detection order (`parse402WithBody`):
1. `WWW-Authenticate: Payment id=` → MPP
2. `PAYMENT-REQUIRED` header → x402 v2
3. Body JSON with `x402Version` → x402 v1

---

## Key Libraries

### x402 Stack
- `@x402/hono` — `paymentMiddleware` + `x402ResourceServer` (server side)
- `@x402/svm/exact/server` → `ExactSvmScheme` (server-side scheme)
- `@payai/facilitator` — `facilitator` config, Solana devnet support
- `@privy-io/node/x402` → `createX402Client` (client signing)
- `@x402/fetch` → `wrapFetchWithPayment` (client fetch wrapper)

### MPP Stack
- `@solana/mpp/server` → `Mppx`, `solana` (server)
- `@solana/mpp/client` → `Mppx`, `solana` (client)
- `@privy-io/node/solana-kit` → `createSolanaKitSigner` (Privy-backed signer)

### Other
- `gill` — browser-compatible Solana keypair generation (guest wallets)
- `@solana/kit` — preferred over `@solana/web3.js` for new code
- `recharts` — charts in dashboard

---

## Local Reference Files
- `JUPITER.txt` — Full Jupiter API docs. Read before working on swap/yield layer.
- `UMBRA.txt` — Full Umbra SDK docs. Read before working on privacy layer.
- Privy MCP: `mcp__privy-docs__search_privy_docs` / `mcp__privy-docs__query_docs_filesystem_privy_docs`
- MPP MCP: `mcp__mpp__search_docs`, `mcp__mpp__read_page`, `mcp__mpp__list_pages`

---

## What Still Needs Building (Priority Order)

1. **CLI** — `agentis login` (browser flow via Privy, polls backend, stores session token), `agentis agent list/create`, `agentis policy set`. Lives in `packages/cli/`.
2. **Quasar on-chain programs** — Agent registry PDA, full policy on-chain (all limits + kill switch + allowed domains up to 10x64chars), spend counters. Tx fees ~$0.00025 so full policy on-chain is fine.
3. **Jupiter facilitator** — agent holds SOL, endpoint needs USDC → Jupiter Swap silently, then pay. Idle funds → Jupiter Earn, auto-withdraw before payments.
4. **MCP server** — expose Agentis as MCP tools. Lives in `packages/mcp/`. Position on top of Jupiter MCP adding policy + payment handling.

**Later:**
- Umbra private payments integration
- Skill (SKILL.md) — free once MCP exists
- Replace JSON DB with real DB (Postgres/SQLite)
- Hash API keys (SHA-256, show plaintext once)
- CLI session token auth in backend middleware

**Discussed, not built:**
- Facilitator Bootstrap CLI (`agentis facilitator bootstrap`) — generates ready-to-deploy Hono MPP facilitator, registers with Agentis backend, dashboard shows directory. Makes Agentis a facilitator network.

---

## Key Resources
- MPP: https://mpp.dev/overview | Stripe MPP: https://docs.stripe.com/payments/machine/mpp
- x402: https://www.x402.org/
- Quasar: https://quasar-lang.com/docs | https://github.com/blueshift-gg/quasar
- Umbra: https://docs.umbraprivacy.com | https://sdk.umbraprivacy.com/llms.txt
- Jupiter: https://dev.jup.ag
- Privy: https://docs.privy.io
- Colosseum: https://colosseum.com/frontier

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
    cli/          ← BUILT (see CLI section below)
    mcp/          ← NOT BUILT YET
  sdk-testing/
    x402-server/  ← Test x402 server (Hono + PayAI + ExactSvmScheme), port 4000
    mpp-server/   ← Test MPP server (@solana/mpp/server), port 4001
    agent-app/    ← Test script using AgentisClient. Has .env with AGENTIS_API_KEY
```

`packages/core` and `packages/sdk` exports point to `src/` directly — no build step needed locally.

---

## What's Built & Working

### SDK (`packages/sdk`) ✅
- `AgentisClient.create({ apiKey, baseUrl })` — bootstraps from backend, seeds spend history
- `agentis.fetch(url)` — drop-in fetch replacement. Detects 402, identifies MPP vs x402, enforces policy, proxies payment through backend
- `agentis.send(to, amountSol, mint?)` — direct SOL/SPL transfer with policy check, proxied through backend
- **MPP flow:** backend uses `createSolanaKitSigner` from `@privy-io/node/solana-kit` + `broadcast: true` — WORKING on devnet
- **x402 flow:** backend uses `createX402Client` from `@privy-io/node/x402` + `wrapFetchWithPayment` from `@x402/fetch` — WORKING on devnet with real USDC
- Policy enforcement before every payment (USD amounts, not SOL)
- Both flows record transactions to DB after successful payment
- Test file: `sdk-testing/agent-app/test-send.ts`

### Backend (`apps/backend`) ✅
Entry: `apps/backend/index.ts`. Env in `apps/backend/.env`.

**Routes:**
- `/agents/*` — CRUD, Privy JWT **or `agt_user_xxx`** auth. Create agent (Privy wallet + `agt_live_xxx` key), PATCH policy, send SOL, regen key, transactions
- `/sdk/*` — API key auth (`x-api-key: agt_live_xxx`). `GET /sdk/agent`, `PATCH /sdk/agent/policy`, `POST /sdk/agent/fetch-paid` (x402), `POST /sdk/agent/fetch-paid-mpp` (MPP), `POST /sdk/agent/send` (direct transfer), `POST /sdk/agent/record-spend`
- `/account/*` — account-level keys (`agt_user_xxx`) for CLI/MCP. `GET /account/agents`, `POST /account/agents`
- `/auth/*` — CLI login flow. `POST /auth/session` (create), `GET /auth/session/:id` (poll), `POST /auth/session/:id/complete` (dashboard calls after Privy login)
- `GET /sol-price` — returns current SOL/USD price (Jupiter Price API v3, cached 60s in memory)

**DB:** JSON file at `apps/backend/data/db.json` (gitignored, temporary). Has `agents`, `accounts`, `loginSessions` arrays.

### Dashboard (`apps/next-app`) ✅
- `/` — landing page, Privy auth
- `/dashboard` — agent list, create modal. Guest mode (localStorage, real devnet keypairs via `gill`)
- `/dashboard/agents/[id]` — wallet, SOL+token balances (devnet RPC, not Jupiter Portfolio), kill switch, spending limits (USD), domain whitelist, save policy button (above tx history), tx history
- `/dashboard/agents/[id]/test` — send SOL test console. Burn address: `5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6`
- `/dashboard/profile` — identity, stats, spend charts (USD), account API key
- `/cli-auth` — browser page for CLI login flow. Auto-completes if already logged in via Privy.

**Token balances:** Uses `getTokenAccountsByOwner` on devnet RPC directly (Jupiter Portfolio API is mainnet-only). Known tokens hardcoded: devnet USDC (`4zMMC9...`), USDT, USDG shown with proper names + USD values.

**Design:** Playfair Display (headings), DM Mono (technical), DM Sans (body). Colors: beige (#f5f0e8), black (#0f0e0c), ink (#2a2620), ink-muted (#6b6459), beige-darker (#d9d0be). Tailwind v4 only, no inline styles except `clamp()`.

### CLI (`packages/cli`) ✅
Published as `@agentis-hq/cli`. Installed globally via `bun link` during dev. Command: `agentis`.
Auth stored in OS keychain via `@napi-rs/keyring` (NOT keytar — keytar broken with Bun).

**Commands:**
- `agentis login` — browser flow via `/cli-auth?session=xxx`, polls backend, saves `agt_user_xxx` to keychain
- `agentis logout` / `agentis whoami`
- `agentis wallet create --name <n> [--local]` — hosted (Privy) if logged in, local if not or --local flag. Shows tip to login if unauthed.
- `agentis wallet list` — shows hosted + local wallets
- `agentis agent list` / `agentis agent create <name>`
- `agentis agent balance <name-or-id>` — SOL + SPL tokens via devnet RPC
- `agentis agent send <name-or-id> <to> <amount> [--sol] [--token <mint>]` — default lamports, --sol for SOL units
- `agentis policy get <name-or-id>` / `agentis policy set <name-or-id> [--kill] [--resume] [--max-per-tx n] [--hourly n] [--daily n] [--monthly n] [--budget n] [--allow domain] [--disallow domain]`

**All agent commands accept name OR id.**

**Local wallets:** BIP-39 mnemonic, scrypt+AES-256-GCM (empty passphrase, OWS-style), stored at `~/.agentis/wallets/<uuid>.json` with chmod 600. Solana keypair derived at `m/44'/501'/0'/0'`.

### Policy Engine (`packages/core/src/policy.ts`) ✅
All amounts in **USD** (not SOL). `checkPolicy(policy, amountUsd, url, history)`.
- Kill switch, domain whitelist, maxPerTx, hourly/daily/monthly/maxBudget limits

---

## Critical Gotchas

### MPP
- **Use `createSolanaKitSigner` from `@privy-io/node/solana-kit`** — NOT manual transaction signing
- **Always `broadcast: true`** on `solanaClient.charge()` — pull mode fails with "Blockhash not found"
- Detect MPP: `/^Payment\s+id=/i.test(wwwAuth)`

### x402
- **Use `createX402Client` from `@privy-io/node/x402`** — NOT `ExactSvmSchemeV1` with manual Privy signer
- x402 v2 uses `PAYMENT-REQUIRED` header (base64 JSON), NOT body JSON
- `PAY_TO` address must have an existing USDC ATA on devnet. Burn address (`5yDpyuSo...`) has NO ATA — don't use as PAY_TO
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- x402 `amount` field = atomic token units (USDC 6 decimals: 1000 = $0.001)
- SOL mint: `So11111111111111111111111111111111111111112`

### Privy
- Use `@privy-io/node` (not `@privy-io/server-auth`) for MPP/x402 signing
- `@privy-io/server-auth` is only for JWT verification
- Run backend from `apps/backend/` directory so `.env` is picked up

### General
- Jupiter Portfolio API is mainnet-only — use `getTokenAccountsByOwner` RPC for devnet token balances
- Jupiter Earn is mainnet-only — program not deployed on devnet
- All spend amounts throughout the system are in **USD**. SOL amounts only stored for raw chain record.
- `@napi-rs/keyring` works with Bun. `keytar` does NOT (native addon ABI mismatch).

---

## Auth Architecture

| Credential | Used by | What it is |
|---|---|---|
| Privy JWT | Dashboard | Short-lived, verified via `privy.verifyAuthToken()` |
| `agt_live_xxx` | SDK | Per-agent API key |
| `agt_user_xxx` | CLI/MCP | Account-level key, stored in OS keychain |

---

## Umbra Privacy Layer (IN PROGRESS)

**What Umbra is:** Privacy protocol on Solana using Arcium MPC + ZK proofs. Devnet fully supported.

**Two separate mechanisms:**

**1. Encrypted Balances (Confidential)**
- Your ATA → shielded pool (deposit). Balance amount hidden, but sender/recipient addresses still visible on-chain.
- You CAN read your own encrypted balance (Shared mode, X25519 key, no MPC needed).
- Transfer to someone else's ETA — recipient must be Umbra registered.
- No ZK proof needed for deposit/withdraw. Fast.
- Use case: hide *how much* you hold. Linkability NOT broken.

**2. Mixer (UTXO)**
- Creates receiver-claimable UTXOs. Sender + recipient completely unlinked on-chain.
- ZK proof required (1-3s Node.js). Relayer required for claiming.
- Recipient must actively scan + claim the UTXO.
- Use case: full anonymity — break the link between sender and recipient.

**What's hidden vs visible:**

| | Encrypted Balance | Mixer |
|---|---|---|
| Sender address | Visible | Hidden |
| Recipient address | Visible | Hidden |
| Amount | Hidden | Hidden |
| That you used Umbra | Visible | Visible |

**For Agentis:**
- x402/MPP payments CANNOT be made private — servers won't scan/claim UTXOs, and ETA transfers require Umbra registration.
- Private mode applies to: agent-to-agent transfers, owner funding/defunding agents privately, hiding agent balance.
- Private toggle on agent creation → agent uses Umbra for direct transfers between Agentis agents.
- Devnet: program `DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ`, indexer `utxo-indexer.api-devnet.umbraprivacy.com`, relayer `relayer.api-devnet.umbraprivacy.com`
- **Supported tokens on devnet: wSOL only confirmed** (`So11111111111111111111111111111111111111112`). devnet USDC (`4zMMC9...`) gives Custom program error #3012.
- SDK: `@umbra-privacy/sdk` v4.0.0, ZK prover: `@umbra-privacy/web-zk-prover` v2.0.1
- Registration: one-time per wallet, `getUserRegistrationFunction({ client }, { zkProver })`, idempotent. Requires `getUserRegistrationProver()` for anonymous mode.

### What's Been Done (Umbra)

**`umbra-test/` — Standalone Next.js 16 test app** (at root of monorepo, no .git)
- Full browser-side Umbra flow WORKING on devnet with in-memory signer:
  - `createInMemorySigner` / `createSignerFromPrivateKeyBytes` — signer persisted in localStorage
  - `getUmbraClient` — devnet config
  - `getUserRegistrationFunction` — confidential + anonymous, with `getUserRegistrationProver()` — WORKS
  - `getPublicBalanceToEncryptedBalanceDirectDepositorFunction` — deposit wSOL — WORKS
  - `getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction` — withdraw — WORKS
  - `getPublicBalanceToReceiverClaimableUtxoCreatorFunction` — UTXO creation — WORKS (returns `{ createProofAccountSignature, createUtxoSignature }` object, NOT array)
  - `getClaimableUtxoScannerFunction` — scan — WORKS. Pass `0n, 0n` as BigInt. Returns `{ received, selfBurnable, publicSelfBurnable, publicReceived }`. UTXOs from public balance go to `publicReceived`, not `received`.
  - `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction` — claim — WORKS. Pass `fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof` in deps. Use `getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver()` (not `getReceiverClaimableUtxoToEncryptedBalanceClaimerProver` — that doesn't exist in package).
- `/test` page — backend integration test page. API key input, calls `/umbra/*` backend routes.

**Backend Umbra routes** (`apps/backend/src/routes/umbra.ts`) — IN PROGRESS:
- `/umbra/register` — registration via Privy wallet
- `/umbra/send-private` — UTXO creation via Privy wallet
- Mounted at `/umbra/*` with CORS for localhost:3000

**Backend Umbra signer wrapper** (`apps/backend/src/lib/umbra-signer.ts`):
- `createUmbraSigner()` — wraps Privy `createSolanaKitSigner` into `IUmbraSigner` interface
- `createUmbraClient()` — creates full Umbra client with Privy signer
- `SolanaKitSigner.signMessages()` returns `SignatureDictionary[]` (array of `{ [address]: Uint8Array }`) — NOT `.signatures` property
- `signTransaction` must spread sigDict into `{ ...tx, signatures: { ...tx.signatures, ...sigDict } }`

**Backend ZK prover** (for Node.js / Bun):
- `apps/backend/src/lib/node-prover.ts` — spawns Node.js subprocess via `Bun.spawn`
- `apps/backend/src/lib/prover-worker.mjs` — runs in Node.js, generates ZK proof, reads stdin/writes stdout
- **WHY:** `@umbra-privacy/web-zk-prover` uses `ffjavascript` which depends on `web-worker` package — this crashes Bun (`web-worker`'s Node.js polyfill uses `worker_threads` which Bun doesn't support correctly)
- BigInt serialization: use `JSON.stringify` replacer `(_, v) => typeof v === 'bigint' ? { __bigint: v.toString() } : v` and reviver in worker
- Proving keys download from CDN first time (~100MB+, takes 2-3 min). Gets cached after.
- **Currently stuck**: registration route hangs after proof generation — likely at `signTransaction` with Privy. Need to debug with logs added to `umbra-signer.ts`.

### Umbra Critical Gotchas
- `getUserRegistrationFunction` for anonymous mode requires `zkProver` in deps — `getUserRegistrationProver()` from `@umbra-privacy/web-zk-prover`
- Scan returns 4 buckets: `received` (from encrypted balance), `publicReceived` (from public balance), `selfBurnable`, `publicSelfBurnable`. Match creation function to correct bucket.
- `getClaimableUtxoScannerFunction` scan args must be BigInt (`0n`) not number (`0`) — type says `U32` but internally expects BigInt
- `web-zk-prover` ZK provers are browser/Node.js only — crash in Bun due to `web-worker` polyfill incompatibility
- Claim result `batches` is a `Map` — `JSON.stringify` serializes it as `{}`. Use `[...map.entries()]` to inspect.
- `NullifierAlreadyBurnt` (error 28004) = UTXO already claimed — not an error, means first claim succeeded
- Relayer `callbackSignature: null` on devnet with wSOL is normal — claim still goes through (nullifier burns on-chain)

---

## Payment Protocols

### MPP (Machine Payments Protocol)
Co-authored by Stripe + Tempo. Key partners: OpenAI, Anthropic, Google Maps, Dune, Modal, fal.ai.
```
Client → GET /resource → 402 + WWW-Authenticate: Payment id="...", request="<base64url>"
Client → Signs challenge, retries with Authorization: Payment <credential>
Server → 200 + payment-receipt header { method, reference (= tx sig), status, timestamp }
```

### x402 (v2)
```
Client → GET /resource → 402 + PAYMENT-REQUIRED: <base64 JSON with accepts[]>
Client → Signs USDC SPL transfer tx (not broadcast), retries with X-Payment: <base64 payload>
Server → PayAI /verify → /settle (broadcasts, pays gas) → 200 + payment-response header
```

### SDK detection order:
1. `WWW-Authenticate: Payment id=` → MPP
2. `PAYMENT-REQUIRED` header → x402 v2
3. Body JSON with `x402Version` → x402 v1

---

## What Still Needs Building (Priority Order)

1. **Umbra backend integration** — fix hanging registration route (debug `signTransaction` with Privy after ZK proof). Then: deposit, withdraw, send-private routes. Then SDK `agentis.sendPrivate()`. Then dashboard private toggle.
2. **MCP server** — expose Agentis as MCP tools. Lives in `packages/mcp/`. Position on top of Jupiter MCP adding policy + payment handling.
3. **Quasar on-chain programs** — Agent registry PDA, full policy on-chain, spend counters.
4. **Jupiter facilitator** — auto-swap SOL→USDC (or any token) before payments when the agent has the wrong token for an endpoint. Jupiter Earn — let users put idle agent funds into yield via MCP/CLI (mainnet only).
5. **Skill file** — free once MCP exists.

**Later:**
- Replace JSON DB with real DB (Postgres/SQLite)
- Hash API keys (SHA-256, show plaintext once)
- Facilitator Bootstrap CLI

---

## Key Libraries

### x402 Stack
- `@x402/hono` — `paymentMiddleware` + `x402ResourceServer` (server side)
- `@privy-io/node/x402` → `createX402Client` (client signing)
- `@x402/fetch` → `wrapFetchWithPayment` (client fetch wrapper)
- `@payai/facilitator` — facilitator config, Solana devnet support

### MPP Stack
- `@solana/mpp/server` → `Mppx`, `solana` (server)
- `@solana/mpp/client` → `Mppx`, `solana` (client)
- `@privy-io/node/solana-kit` → `createSolanaKitSigner`

### CLI Stack
- `@napi-rs/keyring` — OS keychain (works with Bun)
- `@scure/bip39`, `@scure/bip32` — mnemonic + HD derivation
- `@noble/hashes`, `@noble/ciphers`, `@noble/curves` — scrypt + AES-GCM + ed25519

### Umbra Stack
- `@umbra-privacy/sdk` v4.0.0 — `getUmbraClient`, all deposit/withdraw/UTXO/scan/claim functions
- `@umbra-privacy/web-zk-prover` v2.0.1 — ZK provers. Browser + Node.js only (NOT Bun — crashes)
- Backend ZK: spawn Node.js subprocess via `Bun.spawn` running `prover-worker.mjs`
- `IUmbraSigner` interface: `{ address, signTransaction, signTransactions, signMessage }` — wrap Privy `SolanaKitSigner`

### Other
- `gill` — browser-compatible Solana keypair generation (guest wallets in dashboard)
- `@solana/kit` — preferred over `@solana/web3.js` for new code
- `recharts` — charts in dashboard

---

## Local Reference Files
- `JUPITER.txt` — Full Jupiter API docs. Read before working on swap/yield layer.
- `UMBRA.txt` — Full Umbra SDK docs (llms-full.txt). Read before working on privacy layer. Search with grep, don't read whole file.
- Privy MCP: `mcp__privy-docs__search_privy_docs` / `mcp__privy-docs__query_docs_filesystem_privy_docs`
- MPP MCP: `mcp__mpp__search_docs`, `mcp__mpp__read_page`, `mcp__mpp__list_pages`

---

## Key Resources
- MPP: https://mpp.dev/overview | Stripe MPP: https://docs.stripe.com/payments/machine/mpp
- x402: https://www.x402.org/
- Quasar: https://quasar-lang.com/docs | https://github.com/blueshift-gg/quasar
- Umbra: https://docs.umbraprivacy.com
- Jupiter: https://dev.jup.ag
- Privy: https://docs.privy.io
- Colosseum: https://colosseum.com/frontier

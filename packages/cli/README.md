# Agentis CLI (rewrite)

Run from the repo after `bun run build:packages`: `bun packages/cli/src/index.ts --help`.

Set `AGENTIS_API_URL` (defaults to loopback port 3001) and `AGENTIS_TOKEN` in a private environment. Use scoped executor grants for agents, not owner credentials.

- `wallet list [--local]`
- `wallet create --local --name <name>`
- `fetch <url> --wallet <wallet-id> --max-amount-atomic <cap> --key <stable-idempotency-key>`
- `operations create --file <request.json> --key <stable-idempotency-key>`
- `operations list|get <id>|wait <id>`
- `operations approve|reject <id> --hash <operation-hash>` (owner only)
- `capabilities`

Local Solana wallets use web3.js v3 RC + standard SLIP-0010 Ed25519 derivation. Mnemonics are stored in `~/.agentis/wallets-v2` with 0700 directory/0600 file permissions, not printed to stdout. Anyone with file access can recover the wallet. Local sends and legacy hosted commands are not exposed until migrated.

Hosted testnet transfers, Base/Arc/Solana testnet USDC x402 and Tempo alphaUSD MPP paid GETs use the common backend. Mainnet, other x402 networks and plugins remain unavailable. Published npm CLI is still the old prototype; use this checkout.

## x402 paid GET

Create an API key on the existing agent's dashboard page and set `AGENTIS_TOKEN` privately (do not paste it into chat or pass it as a CLI argument). Select that agent's Base wallet from `wallet list`.

```sh
bun packages/cli/src/index.ts fetch 'http://127.0.0.1:3010/api/aqi?city=delhi&rail=base' \
  --wallet 4a6c604f-303f-459c-ae79-fcaa04a67341 --max-amount-atomic 10000 --key research-aqi-001
```

`10000` means a maximum of 0.01 USDC. Backend and worker require `AGENTIS_PAID_FETCH_LOCAL_ORIGINS=http://127.0.0.1:3010` for this local fixture. Otherwise URLs must use public HTTPS; private/mixed DNS, redirects and caller-supplied payment proofs are not allowed. Local exceptions are disabled in production.

- `ask`: returns an approval URL. Approve in the authenticated dashboard, then `operations wait <id>` or `operations get <id>`.
- `automatic`: waits for the operation. Same per-agent rules and atomic USD reservations apply; CLI has no wallet signing keys.
- Reuse the **same key** after any timeout. No automatic second payment. A submitted authorization stays reserved until its exact on-chain nonce settles or the finalized chain proves it expired unused.
- The operation detail returns `httpResponse.status`, `headers` and `bodyBase64`; decode the latter for JSON or binary data. Lists omit response bodies. Payment settlement is independent of HTTP success; a lost response does not erase a settled charge.
- All x402 rails persist the settlement response’s transaction ID as soon as HTTP headers arrive, then verify the approved payment directly on-chain by that ID. Missing-response recovery uses EVM authorization logs or paginated Solana history. Receipt lookup retries never resend payment.
- Base and Arc use EIP-3009 with facilitator-paid gas. Select the corresponding agent wallet and `rail=base` or `rail=arc`. The price ceiling is in 6-decimal USDC units on both. Arc’s operation uses its existing native USDC ledger (18 decimals), with an exact bigint conversion; balances are not counted twice.
- Solana devnet uses `rail=solana` and the agent’s Solana wallet. The facilitator pays gas; the wallet needs USDC in its associated token account. Privy’s native Solana Kit adapter only partially signs a checked transfer: fixed mint/recipient/amount, no lookup tables or extra programs, and an external fee payer. Settlement matches the exact signed message and token balance deltas, not the seller’s HTTP claim. Unresolved submissions remain reserved without resending; automatic unused-expiry release remains follow-up work.

## Tempo MPP paid GET

Use the same `fetch` command with the agent’s Tempo wallet and `--max-fee-atomic`. For the local fixture, use `rail=tempo`, `--max-amount-atomic 10000` (0.01 alphaUSD) and `--max-fee-atomic 10000000000000000` (at most 0.01 alphaUSD gas, expressed in 18-decimal protocol USD units). Both amount and maximum fees are reserved under the same agent budget.

The MPP SDK creates a pull-mode credential using Privy’s native Viem adapter. Only a single approved alphaUSD transfer-with-memo is permitted: no swaps, splits, sponsorship, other assets or other chains. The signed transaction is checked against its sender, call, gas cap and expiry, then persisted before the seller receives it. Approval expires with the challenge. Chain settlement and actual fees are recorded even if the HTTP request fails; an unresolved submission remains reserved and is never blindly resent. Automatic release of unused Tempo submissions is not implemented.

Manual preflight: `testing/privy-x402-preflight.ts` checks challenge/price/recipient/network/fee boundaries, private-URL rejection, and server-quorum signing using a permanently expired zero-value authorization. `--fund` explicitly tops up the selected wallet to 0.05 testnet USDC. A saved funding attempt is never blindly resent. This preflight is not an authenticated paid-fetch end-to-end test.

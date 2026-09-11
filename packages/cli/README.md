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

Hosted testnet transfers and Base Sepolia USDC x402 paid GETs use the common backend. Mainnet, MPP buyer execution, other x402 networks and plugins remain unavailable. Published npm CLI is still the old prototype; use this checkout.

## Base x402 paid GET

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
- x402 EIP-3009 uses a facilitator to pay gas, so the agent reserves the USDC amount with zero payer gas. Only the bound Base USDC typed-data authorization is accepted by the Privy adapter.

Manual preflight: `testing/privy-x402-preflight.ts` checks challenge/price/recipient/network/fee boundaries, private-URL rejection, and server-quorum signing using a permanently expired zero-value authorization. `--fund` explicitly tops up the selected wallet to 0.05 testnet USDC. A saved funding attempt is never blindly resent. This preflight is not an authenticated paid-fetch end-to-end test.

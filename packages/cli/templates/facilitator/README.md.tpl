# {{NAME}}

Kora-backed x402 facilitator scaffolded by Agentis.

## What This Does

- Exposes x402 `/verify`, `/settle`, and `/supported`.
- Uses Kora to sponsor/sign/submit Solana transactions.
- Keeps a local SQLite seller ledger.
- Charges facilitator fees from prepaid seller balances.
- Sends heartbeat metrics to Agentis for operator tracking.

## Run

```bash
bun install
cp .env.example .env
```

Fill `KORA_PRIVATE_KEY`, then fund that signer with devnet SOL. Start Kora and the facilitator in separate terminals:

```bash
bun run kora
bun run dev
```

## Seller Ledger

The seller should advertise a gross x402 price that already accounts for facilitator fees. This facilitator settles the gross payment to the seller, then deducts its configured fee from the seller's prepaid local ledger.

Add or top up a seller:

```bash
curl -X POST http://localhost:3000/admin/sellers \
  -H "content-type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"payTo":"SELLER_WALLET","topUpUsd":10}'
```

## Publish

After deploying publicly:

```bash
agentis facilitator publish {{FACILITATOR_ID}} --url https://your-facilitator.example --listed
```

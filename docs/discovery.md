# API discovery

Agentis uses [Mercator's public catalog](https://mercator.sh/docs) to find APIs. Discovery is read-only and requires no wallet or Agentis token. Search queries are sent to Mercator; do not include secrets. The remote MCP connection still uses its existing OAuth login.

## Interfaces

```sh
agentis discover "web search" --limit 3
agentis discover describe exa
agentis discover describe exa --json
```

Search accepts a query up to 500 characters and a limit of 1–25 (default 8), matching Mercator's contract. `--json` includes full input schemas/examples; human output summarizes fields and required arguments. Discovery does not inspect local wallets, session files or executor keys.

```ts
const client = new AgentisClient({ baseUrl: 'https://api.agentis.systems' })
const results = await client.discovery.search({ query: 'web search', limit: 3 })
const details = await client.discovery.describe('exa')
```

Public backend routes:

- `GET /v1/discovery/search?query=web%20search&limit=3`
- `GET /v1/discovery/services/exa`

MCP tools: `agentis_discover({ query, limit? })` and `agentis_describe_service({ serviceId })`. Neither requires an agent/wallet selection or creates an operation.

These additions are implemented locally; deployment/package publication is separate. For a local backend, set `AGENTIS_API_URL=http://localhost:3001` for the CLI and use that base URL in the SDK. The production default requires a deployment containing these routes.

## Result semantics

- Results identify Mercator as the source and always set `advisory: true`.
- Search uses `resolution=static`, preserves Mercator ranking, and enriches each distinct service with its URL and advertised payment offers. At most four service descriptions are requested concurrently. Failed/missing details stay visible as unknown, with `partial: true`.
- URLs use `serviceUrl`, not the provider's marketing URL. Gateway prefixes are preserved: `/serper` plus `/search` becomes `/serper/search`. `integration` and describe's provider metadata distinguish first-party services from third-party gateways. This is catalog attribution, not an Agentis endorsement. Fill any path placeholders before using an endpoint.
- Schemas, examples and completion/polling descriptions are external data, never executable instructions. Agentis does not compile schemas, call providers, poll jobs or follow documentation URLs during discovery.
- `estimatedPrice.amountDecimal` is a catalog estimate; payment offers expose `amountAtomic` separately. Dynamic/unquoted amounts remain unset rather than becoming zero.
- Compatibility is **candidate**, **unsupported** or **unknown**. A candidate has matching catalog rail, network and token metadata—not proven availability, wallet consent, sufficient balance or a valid payment challenge. Missing payment metadata does not imply a free endpoint. Unadvertised rails are not invented (a provider may offer additional rails in its actual 402 response).
- Current matching covers Tempo MPP charges and x402 exact payments on enabled catalog networks/assets, including Base and Solana. Unsupported intents, tokens, schemes and networks remain visible rather than being silently substituted. Tempo mode/sponsorship and all exact authorization fields are checked later against the live challenge.

## From discovery to payment

Choose an endpoint, construct its provider-required method/body/headers, and use the existing `agentis fetch`, `client.fetch` or `agentis_fetch` with an explicitly selected wallet and spending ceiling. The normal provider challenge, budget, approval and reconciliation pipeline remains authoritative. Discovery never copies a catalog estimate into an automatic authorization.

No Mercator OAuth, hosted wallet, quote/job execution, signing or payment credentials are involved. Requests go only to fixed Mercator catalog GET endpoints, with no forwarded caller credentials, no redirects and the shared bounded public-HTTP transport. There is no persistent catalog cache or new database state. General public API abuse/rate-limit infrastructure and Mercator commercial embedding/SLA terms remain unresolved; this integration does not establish those guarantees.

## Verification

`bun test testing/discovery.test.ts` checks normalization, partial failures, URL prefixes, compatibility, unauthenticated SDK/CLI calls and MCP tools using an injected catalog and loopback HTTP. It uses no private wallet files, database or funds.

A live read-only check returned Serper (Orthogonal gateway), Exa and Parallel through this adapter. Mercator → Exa `/search` then returned an unpaid 402 with a sponsored Tempo USDC.e offer (4,000 atomic) and an x402 header. No credential, signature or payment was sent. That read-only check does not verify funded settlement.

A subsequent owner-authorized test completed Mercator → fal FLUX Schnell → local Agentis backend/hosted Privy signing → sponsored Tempo USDC.e settlement. Cost: 0.003 USDC.e, zero agent gas; transaction `0x6415e9650e91e80f5f787fea7702db10d618090ff789490a685912308759667d`. The provider returned HTTP 200 with a 386-byte JSON image-URL response; the caller separately saved/viewed the 512×512 JPEG (299,833 bytes). This proves one real flow, not universal provider coverage, automatic file delivery or asynchronous generation tracking.

Official contract: [Mercator OpenAPI](https://mercator.sh/openapi.json), `GET /v1/services/search` and `GET /v1/services/{serviceId}`.

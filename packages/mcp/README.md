# Agentis remote MCP

Remote Streamable HTTP MCP with browser OAuth consent. No local MCP process, manual API key or owner-token copying. Hosted wallets only.

## Connect

Connect an HTTP/OAuth-capable client to the production endpoint:

```text
https://api.agentis.systems/mcp
```

For a separate local development backend, use `http://localhost:3001/mcp`.

Example URL-based client configuration:

```json
{
  "mcpServers": {
    "agentis": { "url": "https://api.agentis.systems/mcp" }
  }
}
```

Connect → browser sign-in → explicitly select agents/networks → confirm → return to your client. Nothing is preselected. New networks require new consent. The client stores OAuth tokens; owner credentials stay in the browser.

Cloud-hosted clients cannot reach your laptop's localhost. Use the production HTTPS endpoint, or your own deployed backend. Your client must support Streamable HTTP and browser OAuth.

## Tools

- `agentis_discover`: search the public Mercator catalog by query/limit. No agent/wallet selection, provider call or payment.
- `agentis_describe_service`: inspect provider/gateway endpoints, schemas, examples and advertised payment offers. Candidate compatibility and prices are advisory, not permission to spend. Use existing paid fetch separately. The MCP connection retains its normal OAuth requirement.

- `agentis_list_wallets`: authorized agents, wallets and supported token metadata.
- `agentis_balance`: scoped token balances and estimated USD totals.
- `agentis_policy`: read shared USD limits, mode and spent/reserved amounts.
- `agentis_history`: recent payments across issuing keys within authorized wallets/networks.
- `agentis_send`: decimal token amounts; creates a backend transfer request.
- `agentis_fetch`: x402 USDC or Tempo/Solana MPP charge paid HTTP. Solana defaults to USDC; `asset: 'SOL'` selects native SOL, and `maxFee` is a SOL-denominated ceiling including possible ATA rent (default 0.005). Sponsored Solana charges bind zero agent fees. Tempo/Solana MPP splits bind all recipients to policy/approval, count the total once and include each distinct Solana recipient's possible ATA rent. `method`, `headers`, `body` (UTF-8) or `bodyBase64` preserve the provider request; no JSON-only restriction. Tempo supports OUSD, USDC.e and pathUSD, plus testnet alphaUSD. Optional `asset` selects the payment token; `feeAsset` selects an eligible gas token. Testnet USDC.e cannot pay gas; its creation-time default is OUSD. Provider-sponsored Tempo charges cost the agent zero gas. Tempo push-only offers require agent-paid gas; Agentis persists and confirms payment before sending the provider its hash. Dual-mode offers prefer pull. Payment and HTTP success are separate; same-key retries never automatically pay or request the provider again. Sessions and automatic swaps are not implemented.
- `agentis_get_operation`: status, receipt and paid HTTP response for this connection's operations.
- `agentis_list_operations`: this connection's requests.
- `agentis_capabilities`: execution capabilities and network/asset metadata.
- `agentis_request_operation`: advanced raw operation request.

Use `agentId` from wallet listing for reads and `walletId` for sends/fetches. With multiple connected agents, select the desired agent explicitly. Amounts in friendly send/fetch tools are decimal strings; raw operations use atomic strings. Every payment requires a stable idempotency key. Keep the same key/terms after uncertainty.

Ask mode returns `approvalUrl`: the owner reviews/approves in the dashboard. Automatic mode queues execution within existing policies. Read status with `agentis_get_operation`. A client's tool-call permission prompt is not Agentis payment approval. There are no approve/reject, policy-edit, key-export, credential-administration or local-custody tools.

All payments use the existing backend policy/reservation/signing/reconciliation pipeline. No separate MCP budget or signer. Unknown submission retains reservations and never authorizes a blind resend; an HTTP failure does not mean no payment happened.

## Agentcard plugin tools

Enable the plugin and connect the owner's Vault in the dashboard, then explicitly allow the MCP connection's grant to purchase. Crypto OAuth consent alone does not authorize cards.

- `agentis_cards_setup`: read status and the owner's setup link; no enrollment or consent mutation.
- `agentis_purchase_ask` / `agentis_purchase_conversation`: build a cart and read its original turn; no purchase confirmation.
- `agentis_purchase_confirm`: request purchase of the exact selected cart hash with a stable key. Auto may place the order immediately; Ask waits for owner review.
- `agentis_purchase_execute`: submit an already-authorized request, not approve it.
- `agentis_purchase_continue`: only continue a recorded unpaid provider approval pause, never a timeout.
- `agentis_card_checkouts` / `agentis_card_checkout_get` / `agentis_card_checkout_cancel`: list, read/reconcile and request cancellation of original checkouts. Cancellation is not a refund or merchant order cancellation.

Card requests share USD accounting with mainnet crypto payments but have checkout IDs, not crypto operation IDs. The owner/provider may still need to approve. Never create a replacement purchase after an unknown outcome. Payment completion does not prove merchant order completion. MCP does not perform browser interception or expose replay credentials; use the SDK browser adapter for that flow.

See the [Agentcard guide](https://docs.agentis.systems/docs/agentis/agentcard) for setup. If new tools do not appear, refresh your client's tool list or reconnect.

## Runtime and deployment configuration

The backend serves `/mcp`, OAuth discovery/registration/authorize/token/revoke endpoints, and protected-resource metadata. The dashboard serves `/oauth/authorize`.

- `AGENTIS_PUBLIC_API_URL`: canonical API origin. Default `http://localhost:3001` for development; explicitly configured HTTPS required in production.
- `AGENTIS_MCP_RESOURCE`: canonical `/mcp` URL, default `${AGENTIS_PUBLIC_API_URL}/mcp`.
- `DASHBOARD_URL`: browser application origin.
- Dashboard `NEXT_PUBLIC_BACKEND_URL` must point to that API.
- Apply `0011_remote_mcp_oauth.sql` before starting this version.

The existing `mcp.agentis.systems` Worker can remain a thin HTTP proxy to the API. For that deployment, set backend `AGENTIS_PUBLIC_API_URL=https://api.agentis.systems` and `AGENTIS_MCP_RESOURCE=https://mcp.agentis.systems/mcp`; configure the Worker with `AGENTIS_API_URL=https://api.agentis.systems`. OAuth and tools run in the backend, not a second execution service. No introspection secret is needed. Existing legacy OAuth tokens are not accepted.

## Uniswap plugin

Agents with Uniswap enabled expose eight additional quote/swap/status, rebalance and DCA tools. `agentis_fetch` supports optional `swapFunding: true` for missing **Base Sepolia USDC**. Recurring setup uses a separate owner-confirmation URL, not executor privileges. Tempo MPP auto-funding is not supported on the current testnet; ordinary MPP payments are unchanged.

## Authorization and revocation

OAuth uses exact registered redirects, authorization code + S256 PKCE, client/resource binding, single-use expiring codes, one-hour opaque access tokens and rotating 30-day refresh tokens. Only token/code hashes are stored. Refresh-token reuse revokes the connection and its grants.

Consent creates one explicit-network executor grant per selected agent. MCP internally dispatches through the same authenticated API handlers using server-owned request identities, never browser/owner tokens or public impersonation headers. Grants are rechecked on each internal request and at execution. OAuth bearer tokens are accepted only on `/mcp`, not as owner/API credentials.

Dashboard API access shows `MCP` with the client name. Revoke an agent's MCP entry to remove that connection's access to that agent; other selected agents retain access. OAuth `/oauth/revoke` revokes the entire connection. Revocation cannot undo already submitted transactions.

# Agentis remote MCP

Remote Streamable HTTP MCP with browser OAuth consent. No local MCP process, manual API key or owner-token copying. Hosted wallets only.

## Connect

For local development, a desktop MCP client that supports HTTP OAuth can connect to:

```text
http://localhost:3001/mcp
```

Example URL-based client configuration:

```json
{
  "mcpServers": {
    "agentis": { "url": "http://localhost:3001/mcp" }
  }
}
```

Connect → browser sign-in → explicitly select agents/networks → confirm → return to your client. Nothing is preselected. New networks require new consent. The client stores OAuth tokens; owner credentials stay in the browser.

Cloud-hosted clients cannot reach your laptop's localhost. They need a deployed HTTPS endpoint; this implementation does not deploy or publish it automatically. Actual browser/client consent must still be user-tested.

## Tools

- `agentis_list_wallets`: authorized agents, wallets and supported token metadata.
- `agentis_balance`: scoped token balances and estimated USD totals.
- `agentis_policy`: read shared USD limits, mode and spent/reserved amounts.
- `agentis_history`: recent payments across issuing keys within authorized wallets/networks.
- `agentis_send`: decimal token amounts; creates a backend transfer request.
- `agentis_fetch`: x402 Base/Arc/Solana USDC or Tempo MPP alphaUSD paid GET.
- `agentis_get_operation`: status, receipt and paid HTTP response for this connection's operations.
- `agentis_list_operations`: this connection's requests.
- `agentis_capabilities`: execution capabilities and network/asset metadata.
- `agentis_request_operation`: advanced raw operation request.

Use `agentId` from wallet listing for reads and `walletId` for sends/fetches. With multiple connected agents, select the desired agent explicitly. Amounts in friendly send/fetch tools are decimal strings; raw operations use atomic strings. Every payment requires a stable idempotency key. Keep the same key/terms after uncertainty.

Ask mode returns `approvalUrl`: the owner reviews/approves in the dashboard. Automatic mode queues execution within existing policies. Read status with `agentis_get_operation`. A client's tool-call permission prompt is not Agentis payment approval. There are no approve/reject, policy-edit, key-export, credential-administration or local-custody tools.

All payments use the existing backend policy/reservation/signing/reconciliation pipeline. No separate MCP budget or signer. Unknown submission retains reservations and never authorizes a blind resend; an HTTP failure does not mean no payment happened.

## Runtime and deployment configuration

The backend serves `/mcp`, OAuth discovery/registration/authorize/token/revoke endpoints, and protected-resource metadata. The dashboard serves `/oauth/authorize`.

- `AGENTIS_PUBLIC_API_URL`: canonical API origin. Default `http://localhost:3001` for development; explicitly configured HTTPS required in production.
- `AGENTIS_MCP_RESOURCE`: canonical `/mcp` URL, default `${AGENTIS_PUBLIC_API_URL}/mcp`.
- `DASHBOARD_URL`: browser application origin.
- Dashboard `NEXT_PUBLIC_BACKEND_URL` must point to that API.
- Apply `0011_remote_mcp_oauth.sql` before starting this version.

The existing `mcp.agentis.systems` Worker can remain a thin HTTP proxy to the API. For that deployment, set backend `AGENTIS_PUBLIC_API_URL=https://api.agentis.systems` and `AGENTIS_MCP_RESOURCE=https://mcp.agentis.systems/mcp`; configure the Worker with `AGENTIS_API_URL=https://api.agentis.systems`. OAuth and tools run in the backend, not a second execution service. No introspection secret is needed. Existing legacy OAuth tokens are not accepted.

## Uniswap plugin

Agents with Uniswap enabled expose eight additional quote/swap/status, rebalance and DCA tools. `agentis_fetch` supports optional `swapFunding: true` for missing **Base Sepolia USDC**. Recurring setup uses a separate owner-confirmation URL, not executor privileges. See [plugin scope and commands](../../docs/uniswap.md). Tempo MPP auto-funding is not supported on the current testnet; ordinary MPP payments are unchanged.

## Authorization and revocation

OAuth uses exact registered redirects, authorization code + S256 PKCE, client/resource binding, single-use expiring codes, one-hour opaque access tokens and rotating 30-day refresh tokens. Only token/code hashes are stored. Refresh-token reuse revokes the connection and its grants.

Consent creates one explicit-network executor grant per selected agent. MCP internally dispatches through the same authenticated API handlers using server-owned request identities, never browser/owner tokens or public impersonation headers. Grants are rechecked on each internal request and at execution. OAuth bearer tokens are accepted only on `/mcp`, not as owner/API credentials.

Dashboard API access shows `MCP` with the client name. Revoke an agent's MCP entry to remove that connection's access to that agent; other selected agents retain access. OAuth `/oauth/revoke` revokes the entire connection. Revocation cannot undo already submitted transactions.

## Verification and remaining checks

`testing/remote-mcp-check.ts` uses a throwaway schema in the dedicated local Postgres, real HTTP and the official MCP SDK/OAuth client. It checks discovery, dynamic registration, owner consent, agent/network isolation, PKCE/resource binding, code replay, tool registration, ask-mode links, idempotency, budget denial, refresh rotation/reuse revocation and cancellation. It cannot sign/broadcast and does not alter funded wallets.

Browser Privy consent and a connection from the user's actual MCP app remain manual checks. Real automatic sends and paid x402/MPP were already checked through the common backend/CLI, but fresh paid execution through a real MCP client is not yet verified. Public deployment, auth-endpoint rate limiting and expired OAuth-record housekeeping remain deployment/follow-up work; do not confuse passing local checks with a deployed public connector.

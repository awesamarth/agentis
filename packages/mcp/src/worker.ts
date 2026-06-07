import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createAgentisMcpServer } from './server'

type Env = {
  AGENTIS_API_URL?: string
  AGENTIS_MCP_RESOURCE?: string
  MCP_INTROSPECTION_SECRET: string
  AGENTIS_MAINNET_RPC_URL?: string
}

type Introspection = {
  active: boolean
  sub?: string
  client_id?: string
  scope?: string
  resource?: string
  grant_id?: string
  exp?: number
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function resourceUrl(request: Request, env: Env): string {
  return (env.AGENTIS_MCP_RESOURCE ?? `${new URL(request.url).origin}/mcp`).replace(/\/$/, '')
}

function authorizationServer(env: Env): string {
  return (env.AGENTIS_API_URL ?? 'https://api.agentis.systems').replace(/\/$/, '')
}

function unauthorized(request: Request, env: Env, description = 'Bearer token required'): Response {
  const metadataUrl = `${new URL(request.url).origin}/.well-known/oauth-protected-resource`
  return json(
    { error: 'unauthorized', error_description: description },
    401,
    {
      'www-authenticate': `Bearer resource_metadata="${metadataUrl}"`,
    },
  )
}

async function introspect(token: string, env: Env): Promise<Introspection | null> {
  const response = await fetch(`${authorizationServer(env)}/oauth/introspect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-agentis-mcp-secret': env.MCP_INTROSPECTION_SECRET,
    },
    body: new URLSearchParams({ token }),
  }).catch(() => null)
  if (!response?.ok) return null
  return response.json() as Promise<Introspection>
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return unauthorized(request, env)

  const token = authorization.slice(7)
  const grant = await introspect(token, env)
  if (!grant?.active || !grant.client_id || !grant.sub || !grant.exp) {
    return unauthorized(request, env, 'Access token is invalid or expired')
  }

  const expectedResource = resourceUrl(request, env)
  if (grant.resource !== expectedResource) {
    return unauthorized(request, env, 'Access token was not issued for this MCP resource')
  }

  const scopes = grant.scope?.split(/\s+/).filter(Boolean) ?? []
  const authInfo: AuthInfo = {
    token,
    clientId: grant.client_id,
    scopes,
    expiresAt: grant.exp,
    resource: new URL(expectedResource),
    extra: {
      userId: grant.sub,
      grantId: grant.grant_id,
    },
  }
  const server = createAgentisMcpServer({
    accessToken: token,
    apiBase: authorizationServer(env),
    mainnetRpcUrl: env.AGENTIS_MAINNET_RPC_URL,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  await server.connect(transport)
  try {
    return await transport.handleRequest(request, { authInfo })
  } finally {
    await transport.close()
    await server.close()
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        },
      })
    }
    if (url.pathname === '/health') return json({ status: 'ok', service: 'agentis-mcp' })
    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      return json({
        resource: resourceUrl(request, env),
        authorization_servers: [authorizationServer(env)],
        scopes_supported: [
          'wallets:read',
          'wallets:write',
          'payments:execute',
          'policy:read',
          'policy:write',
          'privacy:read',
          'privacy:write',
          'earn:read',
          'earn:write',
        ],
        bearer_methods_supported: ['header'],
      }, 200, { 'access-control-allow-origin': '*' })
    }
    if (url.pathname !== '/mcp') return json({ error: 'Not found' }, 404)

    const response = await handleMcp(request, env)
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', '*')
    headers.set('access-control-expose-headers', 'mcp-session-id, www-authenticate')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}

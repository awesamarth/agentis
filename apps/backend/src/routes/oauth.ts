import { Hono } from 'hono'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { privy } from '../lib/privy'
import {
  completeOAuthAuthorizationRequest,
  consumeOAuthAuthorizationCode,
  createOAuthAuthorizationCode,
  createOAuthAuthorizationRequest,
  createOAuthGrant,
  getOAuthAuthorizationRequest,
  getOAuthClient,
  getOAuthGrantByAccessToken,
  refreshOAuthGrantAccessToken,
  registerOAuthClient,
  revokeOAuthToken,
} from '../lib/db'

const oauth = new Hono()

const DEFAULT_SCOPES = [
  'wallets:read',
  'wallets:write',
  'payments:execute',
  'policy:read',
  'policy:write',
  'privacy:read',
  'privacy:write',
  'earn:read',
  'earn:write',
  'jupiter:read',
  'jupiter:write',
]
const SCOPE_SET = new Set(DEFAULT_SCOPES)
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
const REFRESH_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000

function apiBase(): string {
  return (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
}

function dashboardBase(): string {
  return (process.env.DASHBOARD_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

function formBody(c: any): Promise<Record<string, string>> {
  return c.req.parseBody().then((body: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]))
  )
}

function oauthError(c: any, error: string, description: string, status = 400) {
  c.header('cache-control', 'no-store')
  return c.json({ error, error_description: description }, status)
}

function parseScope(scope: string | undefined): string[] | null {
  const requested = (scope?.trim() ? scope.trim().split(/\s+/) : DEFAULT_SCOPES)
  const unique = [...new Set(requested)]
  return unique.every(candidate => SCOPE_SET.has(candidate)) ? unique : null
}

function parseResource(resource: string | undefined): string | undefined | null {
  if (!resource) return undefined
  try {
    const parsed = new URL(resource)
    if (parsed.hash || (parsed.protocol !== 'https:' && !isLoopbackUri(parsed))) return null
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isLoopbackUri(uri: URL): boolean {
  return (
    (uri.hostname === '127.0.0.1' || uri.hostname === 'localhost') &&
    uri.protocol === 'http:' &&
    !uri.username &&
    !uri.password &&
    !uri.hash
  )
}

function redirectAllowed(clientId: string, allowed: string[], redirectUri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return false
  }
  if (clientId === 'agentis-cli') return isLoopbackUri(parsed) && parsed.pathname === '/callback'
  return allowed.includes(parsed.toString())
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function tokenPair() {
  return {
    accessToken: `agt_oauth_${randomBytes(32).toString('hex')}`,
    refreshToken: `agt_refresh_${randomBytes(32).toString('hex')}`,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

oauth.get('/authorize', async (c) => {
  const query = c.req.query()
  if (query.response_type !== 'code') {
    return oauthError(c, 'unsupported_response_type', 'Only response_type=code is supported')
  }
  if (!query.client_id || !query.redirect_uri) {
    return oauthError(c, 'invalid_request', 'client_id and redirect_uri are required')
  }
  if (!query.code_challenge || query.code_challenge_method !== 'S256') {
    return oauthError(c, 'invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }

  const client = await getOAuthClient(query.client_id)
  if (!client || !redirectAllowed(client.clientId, client.redirectUris, query.redirect_uri)) {
    return oauthError(c, 'invalid_client', 'Unknown client or redirect URI')
  }
  const scope = parseScope(query.scope)
  if (!scope) return oauthError(c, 'invalid_scope', 'One or more requested scopes are unsupported')
  const resource = parseResource(query.resource)
  if (resource === null) return oauthError(c, 'invalid_target', 'resource must be an HTTPS or loopback URL')

  const request = await createOAuthAuthorizationRequest({
    id: randomBytes(24).toString('hex'),
    clientId: client.clientId,
    redirectUri: query.redirect_uri,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: 'S256',
    scope,
    state: query.state,
    resource,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })

  return c.redirect(`${dashboardBase()}/oauth/authorize?request=${encodeURIComponent(request.id)}`)
})

oauth.get('/request/:id', async (c) => {
  const request = await getOAuthAuthorizationRequest(c.req.param('id'))
  if (!request || request.status !== 'pending' || new Date(request.expiresAt) <= new Date()) {
    return c.json({ error: 'Authorization request not found or expired' }, 404)
  }
  const client = await getOAuthClient(request.clientId)
  if (!client) return c.json({ error: 'OAuth client not found' }, 404)
  return c.json({
    id: request.id,
    clientId: request.clientId,
    clientName: client.clientName,
    scope: request.scope,
    resource: request.resource,
    expiresAt: request.expiresAt,
  })
})

oauth.post('/request/:id/complete', async (c) => {
  const request = await getOAuthAuthorizationRequest(c.req.param('id'))
  if (!request || request.status !== 'pending' || new Date(request.expiresAt) <= new Date()) {
    return c.json({ error: 'Authorization request not found or expired' }, 404)
  }

  const authorization = c.req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)

  let userId: string
  try {
    userId = (await privy.verifyAuthToken(authorization.slice(7))).userId
  } catch {
    return c.json({ error: 'Invalid Privy token' }, 401)
  }

  const body = await c.req.json().catch(() => ({})) as { approved?: boolean }
  if (body.approved === false) {
    await completeOAuthAuthorizationRequest(request.id, { status: 'denied', userId })
    const redirect = new URL(request.redirectUri)
    redirect.searchParams.set('error', 'access_denied')
    if (request.state) redirect.searchParams.set('state', request.state)
    return c.json({ redirectUrl: redirect.toString() })
  }

  const code = randomBytes(32).toString('base64url')
  await createOAuthAuthorizationCode({
    code,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    userId,
    resource: request.resource,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
  })
  await completeOAuthAuthorizationRequest(request.id, { status: 'approved', userId })

  const redirect = new URL(request.redirectUri)
  redirect.searchParams.set('code', code)
  if (request.state) redirect.searchParams.set('state', request.state)
  return c.json({ redirectUrl: redirect.toString() })
})

oauth.post('/token', async (c) => {
  const body = await formBody(c)
  if (!body.client_id) return oauthError(c, 'invalid_request', 'client_id is required')
  const client = await getOAuthClient(body.client_id)
  if (!client) return oauthError(c, 'invalid_client', 'Unknown OAuth client', 401)

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri || !body.code_verifier) {
      return oauthError(c, 'invalid_request', 'code, redirect_uri, and code_verifier are required')
    }
    const authorizationCode = await consumeOAuthAuthorizationCode(body.code, {
      clientId: client.clientId,
      redirectUri: body.redirect_uri,
      codeChallenge: codeChallenge(body.code_verifier),
    })
    if (!authorizationCode) {
      return oauthError(c, 'invalid_grant', 'Authorization code is invalid, expired, or PKCE verification failed')
    }

    const tokens = tokenPair()
    await createOAuthGrant({
      id: randomUUID(),
      userId: authorizationCode.userId,
      clientId: client.clientId,
      clientName: client.clientName,
      scope: authorizationCode.scope,
      resource: authorizationCode.resource,
      ...tokens,
    })
    c.header('cache-control', 'no-store')
    return c.json({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: tokens.refreshToken,
      scope: authorizationCode.scope.join(' '),
    })
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return oauthError(c, 'invalid_request', 'refresh_token is required')
    const accessToken = `agt_oauth_${randomBytes(32).toString('hex')}`
    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString()
    const grant = await refreshOAuthGrantAccessToken({
      refreshToken: body.refresh_token,
      clientId: client.clientId,
      accessToken,
      accessTokenExpiresAt,
    })
    if (!grant) {
      return oauthError(c, 'invalid_grant', 'Refresh token is invalid, expired, or revoked')
    }
    c.header('cache-control', 'no-store')
    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: body.refresh_token,
      scope: grant.scope.join(' '),
    })
  }

  return oauthError(c, 'unsupported_grant_type', 'Supported grants: authorization_code, refresh_token')
})

oauth.post('/revoke', async (c) => {
  const body = await formBody(c)
  if (body.token) await revokeOAuthToken(body.token)
  return new Response(null, { status: 200 })
})

oauth.post('/introspect', async (c) => {
  const expectedSecret = process.env.MCP_INTROSPECTION_SECRET ?? (
    process.env.NODE_ENV === 'production' ? '' : 'agentis-local-mcp-secret'
  )
  if (!expectedSecret) return c.json({ active: false }, 503)
  const suppliedSecret = c.req.header('x-agentis-mcp-secret')
  if (!suppliedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
    return c.json({ active: false }, 401)
  }

  const body = await formBody(c)
  if (!body.token) return c.json({ active: false })
  const grant = await getOAuthGrantByAccessToken(body.token)
  if (!grant) return c.json({ active: false })

  return c.json({
    active: true,
    sub: grant.userId,
    client_id: grant.clientId,
    scope: grant.scope.join(' '),
    resource: grant.resource,
    grant_id: grant.id,
    exp: Math.floor(new Date(grant.accessTokenExpiresAt).getTime() / 1000),
  })
})

oauth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    client_name?: string
    redirect_uris?: string[]
    token_endpoint_auth_method?: string
    grant_types?: string[]
  }
  if (!body.client_name || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return oauthError(c, 'invalid_client_metadata', 'client_name and redirect_uris are required')
  }
  if (!body.redirect_uris.every(uri => {
    try {
      const parsed = new URL(uri)
      return (
        !parsed.hash &&
        !parsed.username &&
        !parsed.password &&
        (parsed.protocol === 'https:' || isLoopbackUri(parsed))
      )
    } catch {
      return false
    }
  })) {
    return oauthError(c, 'invalid_redirect_uri', 'Redirect URIs must use HTTPS or an allowed loopback callback')
  }

  const client = await registerOAuthClient({
    clientId: `agentis_mcp_${randomBytes(18).toString('hex')}`,
    clientName: body.client_name,
    redirectUris: body.redirect_uris.map(uri => new URL(uri).toString()),
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    createdAt: new Date().toISOString(),
  })
  return c.json({
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: client.grantTypes,
    response_types: ['code'],
    client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
  }, 201)
})

export function authorizationServerMetadata() {
  const issuer = apiBase()
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: DEFAULT_SCOPES,
  }
}

export { DEFAULT_SCOPES }
export default oauth

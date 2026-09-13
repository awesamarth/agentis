import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { randomBytes, createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { agents, grants, wallets, oauthClients, oauthRequests, oauthConnections, oauthTokens } from '../db/schema'
import { fail } from '../errors'
import { hash, type OperationService, type Principal } from '../operations'

const id = z.string().uuid()
const selection = z.array(z.object({ agentId: id, chainIds: z.array(z.string().min(1).max(100)).min(1).max(5).refine(chains => new Set(chains).size === chains.length) }).strict()).min(1).max(20).refine(rows => new Set(rows.map(row => row.agentId)).size === rows.length)
const opaque = () => randomBytes(32).toString('base64url')
const date = (ms: number) => new Date(Date.now() + ms)
const validUrl = (value: string) => {
  try { const url = new URL(value); return !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) } catch { return false }
}
type Env = { Variables: { principal: Principal } }
export function remoteOAuth(service: OperationService, issuer: string) {
  if (!validUrl(issuer) || new URL(issuer).pathname !== '/' || new URL(issuer).search) throw Error('AGENTIS_PUBLIC_API_URL must be an HTTPS origin (HTTP loopback allowed locally)')
  issuer = issuer.replace(/\/$/, '')
  const resource = (process.env.AGENTIS_MCP_RESOURCE ?? `${issuer}/mcp`).replace(/\/$/, '')
  if (!validUrl(resource) || new URL(resource).search || new URL(resource).pathname !== '/mcp') throw Error('AGENTIS_MCP_RESOURCE must be the canonical /mcp URL')
  if (process.env.NODE_ENV === 'production' && (!process.env.AGENTIS_PUBLIC_API_URL || !issuer.startsWith('https://') || !resource.startsWith('https://'))) throw Error('Production MCP requires explicit HTTPS API/resource URLs')
  const publicRoutes = new Hono(), ownerRoutes = new Hono<Env>()
  publicRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  publicRoutes.onError((_error, c) => c.json({ error: 'invalid_request', error_description: 'Invalid or expired OAuth request' }, 400))
  const error = (c: Context, code = 'invalid_grant') => c.json({ error: code }, 400)
  const metadata = { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['agentis'] }
  publicRoutes.get('/.well-known/oauth-authorization-server', c => c.json(metadata))
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) publicRoutes.get(path, c => c.json({ resource, authorization_servers: [issuer], scopes_supported: ['agentis'], bearer_methods_supported: ['header'] }))
  publicRoutes.post('/oauth/register', async c => {
    const input = z.object({ client_name: z.string().trim().min(1).max(100).default('MCP client'), redirect_uris: z.array(z.string().max(2048).refine(validUrl)).min(1).max(10), token_endpoint_auth_method: z.literal('none').default('none'), grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(), response_types: z.array(z.literal('code')).optional() }).parse(await c.req.json())
    const [client] = await service.db.insert(oauthClients).values({ name: input.client_name, redirectUris: [...new Set(input.redirect_uris)] }).returning()
    return c.json({ client_id: client!.id, client_name: client!.name, redirect_uris: client!.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201)
  })
  publicRoutes.get('/oauth/authorize', async c => {
    const input = z.object({ client_id: id, redirect_uri: z.string().max(2048), response_type: z.literal('code'), code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'), state: z.string().max(1024).optional(), resource: z.literal(resource).optional(), scope: z.literal('agentis').optional() }).parse(c.req.query())
    const [client] = await service.db.select().from(oauthClients).where(eq(oauthClients.id, input.client_id))
    if (!client || !client.redirectUris.includes(input.redirect_uri)) return error(c, 'invalid_request')
    const [request] = await service.db.insert(oauthRequests).values({ clientId: client.id, redirectUri: input.redirect_uri, challenge: input.code_challenge, state: input.state, resource, expiresAt: date(600_000) }).returning()
    return c.redirect(`${service.dashboardUrl}/oauth/authorize?request=${request!.id}`)
  })
  type Tx = Parameters<Parameters<typeof service.db.transaction>[0]>[0]
  async function issue(tx: Tx, connection: typeof oauthConnections.$inferSelect) {
    const active = await tx.select().from(grants).where(and(eq(grants.ownerId, connection.ownerId), inArray(grants.id, connection.grantIds)))
    if (!active.some(grant => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()))) return null
    const connectionId = connection.id
    const access = `agt_mcp_${opaque()}`, refresh = `agt_refresh_${opaque()}`
    await tx.insert(oauthTokens).values([
      { connectionId, kind: 'access', tokenHash: hash(access), expiresAt: date(3_600_000) },
      { connectionId, kind: 'refresh', tokenHash: hash(refresh), expiresAt: date(30 * 86_400_000) },
    ])
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: 'agentis' }
  }
  publicRoutes.post('/oauth/token', async c => {
    const body = Object.fromEntries(new URLSearchParams(await c.req.text()))
    const clientId = id.parse(body.client_id)
    if (body.resource && body.resource !== resource) return error(c, 'invalid_target')
    if (body.scope && body.scope !== 'agentis') return error(c, 'invalid_scope')
    if (body.grant_type === 'authorization_code') {
      const verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).parse(body.code_verifier)
      const code = z.string().min(20).max(200).parse(body.code)
      const result = await service.db.transaction(async tx => {
        const [request] = await tx.select().from(oauthRequests).where(eq(oauthRequests.codeHash, hash(code))).for('update')
        if (!request || request.consumedAt || !request.completedAt || !request.connectionId || request.expiresAt.getTime() <= Date.now() || request.clientId !== clientId || request.redirectUri !== body.redirect_uri || request.resource !== resource || request.challenge !== createHash('sha256').update(verifier).digest('base64url')) return null
        const [connection] = await tx.select().from(oauthConnections).where(eq(oauthConnections.id, request.connectionId)).for('update')
        if (!connection || connection.revokedAt) return null
        await tx.update(oauthRequests).set({ consumedAt: new Date() }).where(eq(oauthRequests.id, request.id))
        return issue(tx, connection)
      })
      return result ? c.json(result) : error(c)
    }
    if (body.grant_type === 'refresh_token') {
      const token = z.string().min(20).max(200).parse(body.refresh_token)
      const result = await service.db.transaction(async tx => {
        const [record] = await tx.select().from(oauthTokens).where(and(eq(oauthTokens.tokenHash, hash(token)), eq(oauthTokens.kind, 'refresh'))).for('update')
        if (!record) return null
        const [connection] = await tx.select().from(oauthConnections).where(eq(oauthConnections.id, record.connectionId)).for('update')
        if (!connection || connection.revokedAt || connection.clientId !== clientId || connection.resource !== resource) return null
        if (record.usedAt) {
          // Commit replay revocation; throwing here would roll it back.
          await tx.update(oauthConnections).set({ revokedAt: new Date() }).where(eq(oauthConnections.id, connection.id))
          await tx.update(grants).set({ revokedAt: new Date() }).where(inArray(grants.id, connection.grantIds))
          return null
        }
        if (record.expiresAt.getTime() <= Date.now()) return null
        await tx.update(oauthTokens).set({ usedAt: new Date() }).where(eq(oauthTokens.id, record.id))
        return issue(tx, connection)
      })
      return result ? c.json(result) : error(c)
    }
    return error(c, 'unsupported_grant_type')
  })
  publicRoutes.post('/oauth/revoke', async c => {
    const body = Object.fromEntries(new URLSearchParams(await c.req.text()))
    if (!body.token || body.token.length > 200) return c.body(null, 200)
    await service.db.transaction(async tx => {
      const [token] = await tx.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, hash(body.token!)))
      if (!token) return
      const [connection] = await tx.select().from(oauthConnections).where(eq(oauthConnections.id, token.connectionId)).for('update')
      if (!connection || (body.client_id && body.client_id !== connection.clientId)) return
      await tx.update(oauthConnections).set({ revokedAt: new Date() }).where(eq(oauthConnections.id, connection.id))
      await tx.update(grants).set({ revokedAt: new Date() }).where(inArray(grants.id, connection.grantIds))
    })
    return c.body(null, 200)
  })
  ownerRoutes.use('*', async (c, next) => { if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can authorize MCP'); await next() })
  ownerRoutes.get('/requests/:id', async c => {
    const [request] = await service.db.select().from(oauthRequests).where(eq(oauthRequests.id, id.parse(c.req.param('id'))))
    if (!request || request.expiresAt.getTime() <= Date.now()) fail(404, 'not_found', 'Connection request expired; reconnect from your MCP client')
    const [client] = await service.db.select().from(oauthClients).where(eq(oauthClients.id, request.clientId))
    return c.json({ id: request.id, clientName: client!.name, redirectUri: request.redirectUri, resource, expiresAt: request.expiresAt.toISOString(), completed: !!request.completedAt })
  })
  ownerRoutes.post('/requests/:id/complete', async c => {
    const input = z.discriminatedUnion('approve', [z.object({ approve: z.literal(false) }).strict(), z.object({ approve: z.literal(true), confirm: z.literal(true), selections: selection }).strict()]).parse(await c.req.json())
    const ownerId = c.get('principal').ownerId
    const redirect = await service.db.transaction(async tx => {
      const [request] = await tx.select().from(oauthRequests).where(eq(oauthRequests.id, id.parse(c.req.param('id')))).for('update')
      if (!request || request.completedAt || request.expiresAt.getTime() <= Date.now()) fail(409, 'request_unavailable', 'Connection request expired or already completed')
      const url = new URL(request.redirectUri)
      if (request.state !== null) url.searchParams.set('state', request.state)
      if (!input.approve) {
        await tx.update(oauthRequests).set({ completedAt: new Date(), consumedAt: new Date() }).where(eq(oauthRequests.id, request.id))
        url.searchParams.set('error', 'access_denied'); return url.href
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${ownerId}`}, 0))`)
      const [client] = await tx.select().from(oauthClients).where(eq(oauthClients.id, request.clientId))
      const grantIds: string[] = []
      for (const selected of input.selections) {
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, selected.agentId), eq(agents.ownerId, ownerId)))
        const enabled = await tx.select().from(wallets).where(and(eq(wallets.ownerId, ownerId), eq(wallets.agentId, selected.agentId), eq(wallets.enabled, true)))
        if (!agent || selected.chainIds.some(chain => !enabled.some(wallet => wallet.chainId === chain))) fail(403, 'invalid_selection', 'Select only your enabled agent networks')
        // No reusable executor secret is issued. OAuth delegates these grant IDs
        // internally; all actual payment paths retain their normal grant checks.
        const [grant] = await tx.insert(grants).values({ ownerId, agentId: agent.id, chainIds: selected.chainIds, agentName: `MCP · ${client!.name}`, tokenHash: hash(opaque()) }).returning()
        grantIds.push(grant!.id)
      }
      const [connection] = await tx.insert(oauthConnections).values({ ownerId, clientId: request.clientId, resource, grantIds }).returning()
      const code = opaque()
      await tx.update(oauthRequests).set({ connectionId: connection!.id, codeHash: hash(code), completedAt: new Date(), expiresAt: date(60_000) }).where(eq(oauthRequests.id, request.id))
      url.searchParams.set('code', code); return url.href
    })
    return c.json({ redirectUrl: redirect })
  })
  async function access(token: string) {
    if (!/^agt_mcp_[A-Za-z0-9_-]{43}$/.test(token)) return null
    const [record] = await service.db.select().from(oauthTokens).where(and(eq(oauthTokens.tokenHash, hash(token)), eq(oauthTokens.kind, 'access')))
    if (!record || record.expiresAt.getTime() <= Date.now()) return null
    const [connection] = await service.db.select().from(oauthConnections).where(eq(oauthConnections.id, record.connectionId))
    if (!connection || connection.revokedAt || connection.resource !== resource) return null
    const active = (await service.db.select().from(grants).where(and(eq(grants.ownerId, connection.ownerId), inArray(grants.id, connection.grantIds)))).filter(grant => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()))
    return active.length ? { connection, grants: active, expiresAt: record.expiresAt } : null
  }
  return { publicRoutes, ownerRoutes, access, issuer, resource }
}

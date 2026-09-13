import { Hono } from 'hono'
import { resolveRecipient } from './plugins/ens/resolution'
import { ensRoutes } from './plugins/ens/routes'
import { AgentisClient } from '@agentis-hq/sdk'
import { createAgentisMcpServer, WebStandardStreamableHTTPServerTransport } from '@agentis-hq/mcp'
import { remoteOAuth } from './modules/oauth'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { approvalInput, grantInput, walletPolicy } from '@agentis-hq/core/operations'
import { agents, grants, wallets } from './db/schema'
import { agentBalance } from './modules/balances'
import { ApiError, fail } from './errors'
import { hash, OperationService, type Principal } from './operations'
import { defaultProductChain, supportedNetworks } from './modules/networks'
import { onboardingRoutes } from './modules/onboarding'
import { profileSummary } from './modules/profile'
import { cliLoginRoutes } from './modules/cli-login'

export type Identity = {
  authenticate(token: string): Promise<string>
  testJwtRest?(userJwt: string): Promise<{ ok: boolean; status: number; error: string | null; requestId: string | null }>
  createTestWallet?(ownerId: string, requestId: string): Promise<{ providerWalletId: string; address: string; serverAuthorized?: boolean }>
  exportTestWallet?(ownerId: string, requestId: string, userJwt: string, signer?: 'user' | 'server'): Promise<{ privateKey: string }>
  exportWallet?(id: string, ownerId: string, address: string, chainType: 'ethereum' | 'solana', userJwt: string): Promise<{ privateKey: string }>
  createWallet?(ownerId: string, chainType: 'ethereum' | 'solana', agentId?: string): Promise<{ providerWalletId: string; address: string; chainType: string; serverAuthorized?: boolean }>
  enableServerExecution?(id: string, ownerId: string, userJwt: string): Promise<{ serverAuthorized: boolean }>
  inspectWallet?(id: string, ownerId: string): Promise<{ providerWalletId: string; address: string; chainType: string }>
}
const id = z.string().uuid()
export function createApp(service: OperationService, identity: Identity, origins: string[]) {
  const app = new Hono<{ Variables: { principal: Principal; delegated?: Principal } }>()
  const issuer = (process.env.AGENTIS_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
  const oauth = remoteOAuth(service, issuer)
  // Only this process can associate a Request object with a delegated principal.
  // No public header/token can select or forge an internal delegation.
  const delegatedRequests = new WeakMap<Request, Principal>()
  app.use('*', async (c, next) => {
    const delegated = delegatedRequests.get(c.req.raw)
    delegatedRequests.delete(c.req.raw)
    if (delegated) c.set('delegated', delegated)
    await next()
  })
  app.use('*', bodyLimit({ maxSize: 32 * 1024 }))
  app.use('*', cors({ origin: (origin, c) => c.req.path === '/mcp' || c.req.path.startsWith('/oauth/') || c.req.path.startsWith('/.well-known/') ? '*' : origins.includes(origin) ? origin : '', allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'MCP-Protocol-Version', 'Last-Event-ID'], exposeHeaders: ['WWW-Authenticate', 'MCP-Protocol-Version'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: { code: 'invalid_request', message: 'Invalid request body or parameters' } }, 400)
    // Do not put SQL, provider payloads or credentials in public errors/logs.
    return c.json({ error: { code: 'internal_error', message: 'Request failed; retry with the same idempotency key if applicable' } }, 500)
  })
  app.get('/health', c => c.json({ status: 'ok', version: 'rewrite', execution: service.executor?.id ?? 'disabled' }))
  app.route('/', oauth.publicRoutes)
  app.all('/mcp', async c => {
    const bearer = c.req.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1] ?? ''
    const access = await oauth.access(bearer)
    if (!access) return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"` })
    const names = await service.db.select({ id: agents.id, name: agents.name, plugins: agents.plugins }).from(agents).where(and(eq(agents.ownerId, access.connection.ownerId), inArray(agents.id, access.grants.map(grant => grant.agentId!))))
    const delegations = access.grants.filter(grant => names.some(agent => agent.id === grant.agentId)).map(grant => ({
      agentId: grant.agentId!, name: names.find(agent => agent.id === grant.agentId)!.name, plugins: names.find(agent => agent.id === grant.agentId)!.plugins,
      client: new AgentisClient({ baseUrl: issuer, token: 'internal-delegation', fetch: Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
        if (new URL(request.url).origin !== issuer || !new URL(request.url).pathname.startsWith('/v1/')) throw Error('Invalid internal request')
        delegatedRequests.set(request, { kind: 'agent', ownerId: grant.ownerId, grantId: grant.id })
        return app.fetch(request)
      }, { preconnect: fetch.preconnect }) }),
    }))
    if (!delegations.length) return c.json({ error: 'unauthorized' }, 401)
    const server = createAgentisMcpServer({ delegations, networks: supportedNetworks })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: [new URL(issuer).host] })
    await server.connect(transport)
    try { return await transport.handleRequest(c.req.raw, { authInfo: { token: bearer, clientId: access.connection.clientId, scopes: ['agentis'], expiresAt: Math.floor(access.expiresAt.getTime() / 1000), resource: new URL(oauth.resource) } }) }
    finally { await transport.close(); await server.close() }
  })
  const cliLogin = cliLoginRoutes(service)
  app.route('/v1/cli/logins', cliLogin.publicRoutes)
  app.get('/v1/ens/resolve', async c => c.json(await resolveRecipient(z.string().min(1).max(255).parse(c.req.query('name')), z.string().max(128).parse(c.req.query('chainId')))))
  app.use('/v1/*', async (c, next) => {
    const delegated = c.get('delegated')
    if (delegated?.kind === 'agent') {
      const [grant] = await service.db.select().from(grants).where(and(eq(grants.id, delegated.grantId), eq(grants.ownerId, delegated.ownerId)))
      if (!grant || grant.revokedAt || (grant.expiresAt !== null && grant.expiresAt.getTime() <= Date.now())) fail(401, 'unauthorized', 'Inactive executor grant')
      c.set('principal', delegated); await next(); return
    }
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token) fail(401, 'unauthorized', 'Bearer token required')
    if (token.startsWith('agt_exec_')) {
      const [grant] = await service.db.select().from(grants).where(eq(grants.tokenHash, hash(token)))
      if (!grant || grant.revokedAt || (grant.expiresAt !== null && grant.expiresAt.getTime() <= Date.now())) fail(401, 'unauthorized', 'Inactive executor grant')
      c.set('principal', { kind: 'agent', ownerId: grant.ownerId, grantId: grant.id })
    } else {
      let ownerId: string
      try { ownerId = await identity.authenticate(token) } catch { fail(401, 'unauthorized', 'Invalid owner token') }
      c.set('principal', { kind: 'owner', ownerId })
    }
    await next()
  })
  app.route('/v1/cli/logins', cliLogin.ownerRoutes)
  app.route('/v1/oauth', oauth.ownerRoutes)
  // Local manual test only: provider wallets, never Agentis database records.
  app.use('/v1/test/*', async (c, next) => {
    if (process.env.NODE_ENV === 'production' || !origins.some(origin => ['localhost', '127.0.0.1'].includes(new URL(origin).hostname))) fail(404, 'not_found', 'Not found')
    if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can run this test')
    await next()
  })
  app.post('/v1/test/privy-jwt-rest', async c => {
    if (!identity.testJwtRest) fail(503, 'provider_unavailable', 'Privy REST test unavailable')
    return c.json(await identity.testJwtRest(c.req.header('authorization')!.slice(7)))
  })
  app.post('/v1/test/privy-token-comparison', async c => {
    const input = z.object({ privyToken: z.string().max(16384).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).nullable() }).strict().parse(await c.req.json())
    if (!identity.testJwtRest) fail(503, 'provider_unavailable', 'Privy REST test unavailable')
    const customer = c.req.header('authorization')!.slice(7)
    const claims = (token: string) => z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()))
    const customerClaims = claims(customer)
    const customerResult = await identity.testJwtRest(customer)
    if (!input.privyToken) return c.json({ customer: { fingerprint: hash(customer).slice(0, 12), exchange: customerResult }, privy: null, note: 'No internal token found in browser storage; this does not prove the SDK is not using one.' })
    const privyClaims = claims(input.privyToken)
    const subjectMatches = privyClaims.sub === c.get('principal').ownerId
    return c.json({
      sameToken: customer === input.privyToken,
      customer: { fingerprint: hash(customer).slice(0, 12), exchange: customerResult },
      privy: {
        fingerprint: hash(input.privyToken).slice(0, 12), subjectMatches,
        issuerMatchesCustomer: privyClaims.iss === customerClaims.iss,
        audienceMatchesCustomer: JSON.stringify(privyClaims.aud) === JSON.stringify(customerClaims.aud),
        sessionMatchesCustomer: typeof privyClaims.sid === 'string' && privyClaims.sid === customerClaims.sid,
        secondsToExpiry: typeof privyClaims.exp === 'number' ? Math.floor(privyClaims.exp - Date.now() / 1000) : null,
        exchange: subjectMatches ? await identity.testJwtRest(input.privyToken) : { skipped: 'Internal token subject does not match the authenticated owner' },
      },
    })
  })
  app.post('/v1/test/quorum-wallets', async c => {
    const input = z.object({ requestId: id }).strict().parse(await c.req.json())
    if (!identity.createTestWallet) fail(503, 'provider_unavailable', 'Privy test unavailable')
    return c.json(await identity.createTestWallet(c.get('principal').ownerId, input.requestId))
  })
  app.post('/v1/test/quorum-wallets/export', async c => {
    const input = z.object({ requestId: id, confirm: z.literal(true) }).strict().parse(await c.req.json())
    if (!identity.exportTestWallet) fail(503, 'provider_unavailable', 'Privy test unavailable')
    return c.json(await identity.exportTestWallet(c.get('principal').ownerId, input.requestId, c.req.header('authorization')!.slice(7)))
  })
  app.post('/v1/test/quorum-wallets/export-server', async c => {
    const input = z.object({ requestId: id, confirm: z.literal(true) }).strict().parse(await c.req.json())
    if (!identity.exportTestWallet) fail(503, 'provider_unavailable', 'Privy test unavailable')
    return c.json(await identity.exportTestWallet(c.get('principal').ownerId, input.requestId, c.req.header('authorization')!.slice(7), 'server'))
  })
  app.get('/v1/agents/:id/balance', async c => {
    const principal = c.get('principal')
    const agentId = id.parse(c.req.param('id'))
    let walletScope = and(eq(wallets.agentId, agentId), eq(wallets.ownerId, principal.ownerId), eq(wallets.enabled, true))
    if (principal.kind === 'agent') {
      const [grant] = await service.db.select().from(grants).where(eq(grants.id, principal.grantId))
      if (!grant || grant.ownerId !== principal.ownerId || grant.revokedAt || (grant.expiresAt !== null && grant.expiresAt.getTime() <= Date.now())) fail(403, 'grant_inactive', 'Access key is inactive')
      if (!grant.walletId && grant.agentId !== agentId) fail(404, 'not_found', 'Agent not found')
      walletScope = and(walletScope, grant.walletId ? eq(wallets.id, grant.walletId) : undefined, grant.chainIds === null ? undefined : inArray(wallets.chainId, grant.chainIds))
    }
    const [agent] = await service.db.select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerId, principal.ownerId)))
    if (!agent) fail(404, 'not_found', 'Agent not found')
    const enabled = await service.db.select().from(wallets).where(walletScope)
    if (principal.kind === 'agent' && !enabled.length) fail(404, 'not_found', 'No accessible agent wallets')
    return c.json(await agentBalance(enabled))
  })
  app.route('/v1', onboardingRoutes(service, identity))
  app.get('/v1/capabilities', c => c.json({ defaultChain: defaultProductChain, networks: Object.fromEntries(supportedNetworks.map(network => [network.chainId, { name: network.name, testnet: network.testnet, execution: service.executor?.id === 'privy' }])), core: { transfers: !!service.executor, x402: service.executor?.id === 'privy', mpp: service.executor?.id === 'privy' }, paidFetch: { methods: ['GET'], x402Networks: service.executor?.id === 'privy' ? ['eip155:84532', 'eip155:5042002', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'] : [], mppNetworks: service.executor?.id === 'privy' ? ['eip155:42431'] : [] }, plugins: service.config, pluginCatalog: [{ id: 'uniswap', scope: 'agent', networks: ['eip155:84532'], features: ['swap', 'rebalance', 'dca', 'gas_refill', 'x402_shortfall_funding'] }], executor: service.executor?.id ?? null, approvalSecurity: service.executor?.id === 'anvil' ? 'local-demo-app-authorization' : service.executor?.id === 'privy' ? 'backend-policy-and-owner-approval' : 'live-execution-unavailable' }))
  app.get('/v1/wallets', async c => {
    const principal = c.get('principal')
    let scope = eq(wallets.ownerId, principal.ownerId)
    if (principal.kind === 'agent') {
      const [grant] = await service.db.select().from(grants).where(eq(grants.id, principal.grantId))
      if (!grant || grant.ownerId !== principal.ownerId || grant.revokedAt || (grant.expiresAt !== null && grant.expiresAt.getTime() <= Date.now())) fail(403, 'grant_inactive', 'Access key is inactive')
      scope = and(scope, eq(wallets.enabled, true), grant.walletId ? eq(wallets.id, grant.walletId) : eq(wallets.agentId, grant.agentId!), grant.chainIds === null ? undefined : inArray(wallets.chainId, grant.chainIds))!
    }
    return c.json(await service.db.select({ id: wallets.id, agentId: wallets.agentId, agentName: agents.name, agentPlugins: agents.plugins, address: wallets.address, chainId: wallets.chainId, policy: wallets.policy, policyVersion: wallets.policyVersion, enabled: wallets.enabled, serverAuthorized: wallets.serverAuthorized }).from(wallets).leftJoin(agents, and(eq(agents.id, wallets.agentId), eq(agents.ownerId, wallets.ownerId))).where(scope))
  })
  app.post('/v1/wallets', async c => {
    const principal = c.get('principal')
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can link wallets')
    const body = z.object({ providerWalletId: z.string().min(1).max(128), chainId: z.enum(['eip155:8453', 'eip155:84532', 'eip155:1']), policy: walletPolicy }).strict().parse(await c.req.json())
    if (!identity.inspectWallet) fail(503, 'provider_unavailable', 'Privy wallet linking unavailable')
    const checked = await identity.inspectWallet(body.providerWalletId, principal.ownerId)
    if (checked.chainType !== 'ethereum') fail(400, 'chain_mismatch', 'Expected Ethereum wallet')
    const [wallet] = await service.db.insert(wallets).values({ ...checked, ownerId: principal.ownerId, chainId: body.chainId, policy: body.policy, provider: 'privy' }).onConflictDoNothing().returning()
    if (!wallet) fail(409, 'wallet_exists', 'Wallet already linked')
    return c.json({ id: wallet.id, address: wallet.address, chainId: wallet.chainId, policy: wallet.policy, policyVersion: wallet.policyVersion, enabled: wallet.enabled }, 201)
  })
  app.post('/v1/wallets/:id/export', async c => {
    const principal = c.get('principal')
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can export a wallet')
    z.object({ confirm: z.literal(true) }).strict().parse(await c.req.json())
    const [wallet] = await service.db.select().from(wallets).where(and(eq(wallets.id, id.parse(c.req.param('id'))), eq(wallets.ownerId, principal.ownerId)))
    if (!wallet) fail(404, 'not_found', 'Wallet not found')
    const network = supportedNetworks.find(network => network.chainId === wallet.chainId)
    if (wallet.provider !== 'privy' || !network || !identity.exportWallet) fail(503, 'export_unavailable', 'Owner-authorized export is unavailable for this wallet')
    return c.json(await identity.exportWallet(wallet.providerWalletId, principal.ownerId, wallet.address, network.chainType, c.req.header('authorization')!.slice(7)))
  })
  app.patch('/v1/wallets/:id/policy', async c => {
    const result = await service.setPolicy(c.get('principal'), id.parse(c.req.param('id')), await c.req.json())
    return c.json({ id: result.id, policy: result.policy, policyVersion: result.policyVersion })
  })
  app.get('/v1/profile', async c => {
    const principal = c.get('principal')
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Profile requires owner access')
    return c.json(await profileSummary(service, principal.ownerId))
  })
  app.get('/v1/grants', async c => {
    const principal = c.get('principal')
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Access management requires owner access')
    return c.json(await service.db.select({ id: grants.id, walletId: grants.walletId, agentId: grants.agentId, chainIds: grants.chainIds, name: grants.agentName, expiresAt: grants.expiresAt, revokedAt: grants.revokedAt }).from(grants).where(eq(grants.ownerId, principal.ownerId)))
  })
  app.post('/v1/grants', async c => c.json(await service.createGrant(c.get('principal'), grantInput.parse(await c.req.json())), 201))
  app.delete('/v1/grants/:id', async c => { await service.revoke(c.get('principal'), id.parse(c.req.param('id'))); return c.body(null, 204) })
  app.route('/v1/plugins/ens', ensRoutes(service))
  app.post('/v1/plugins/uniswap/dca-requests', async c => c.json(await service.uniswap.requestSetup(c.get('principal'), await c.req.json()), 201))
  app.get('/v1/plugins/uniswap/dca-requests/:id', async c => c.json(await service.uniswap.setup(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/v1/plugins/uniswap/dca-requests/:id', async c => {
    const input = z.object({ approve: z.boolean(), confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await service.uniswap.completeSetup(c.get('principal'), id.parse(c.req.param('id')), input.approve))
  })
  app.post('/v1/plugins/uniswap/fetch', async c => c.json(await service.uniswap.fundFetch(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.post('/v1/plugins/uniswap/quote', async c => c.json(await service.uniswap.quote(c.get('principal'), await c.req.json())))
  app.post('/v1/plugins/uniswap/swaps', async c => c.json(await service.uniswap.create(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.get('/v1/plugins/uniswap/swaps/:id', async c => c.json(await service.uniswap.get(c.get('principal'), id.parse(c.req.param('id')))))
  app.get('/v1/plugins/uniswap/rebalance-target', async c => c.json(await service.uniswap.target(c.get('principal'), id.parse(c.req.query('walletId')))))
  app.post('/v1/plugins/uniswap/rebalance-target', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.uniswap.saveTarget(c.get('principal'), input.walletId, input.ethPercent))
  })
  app.post('/v1/plugins/uniswap/rebalance/execute', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.uniswap.executeRebalance(c.get('principal'), input.walletId, input.ethPercent, c.req.header('Idempotency-Key') ?? ''), 202)
  })
  app.post('/v1/plugins/uniswap/rebalance', async c => {
    const input = z.object({ walletId: id, ethPercent: z.number().int().min(0).max(100) }).strict().parse(await c.req.json())
    return c.json(await service.uniswap.rebalance(c.get('principal'), input.walletId, input.ethPercent))
  })
  app.get('/v1/plugins/uniswap/dca', async c => c.json(await service.uniswap.listSchedules(c.get('principal'), id.parse(c.req.query('walletId')))))
  app.post('/v1/plugins/uniswap/dca', async c => c.json(await service.uniswap.saveSchedule(c.get('principal'), await c.req.json()), 201))
  app.put('/v1/plugins/uniswap/dca/:id', async c => c.json(await service.uniswap.saveSchedule(c.get('principal'), await c.req.json(), id.parse(c.req.param('id')))))
  app.patch('/v1/plugins/uniswap/dca/:id', async c => {
    const input = z.object({ status: z.enum(['active', 'paused', 'cancelled']), confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await service.uniswap.scheduleStatus(c.get('principal'), id.parse(c.req.param('id')), input.status))
  })
  app.post('/v1/fetch', async c => c.json(await service.fetch(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.get('/v1/wallets/:id/policy', async c => c.json(await service.policyView(c.get('principal'), id.parse(c.req.param('id')))))
  app.get('/v1/history', async c => c.json(await service.history(c.get('principal'))))
  app.get('/v1/operations', async c => c.json(await service.list(c.get('principal'), c.req.query('agentId') === undefined ? undefined : id.parse(c.req.query('agentId')))))
  app.post('/v1/operations', async c => c.json(await service.create(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? ''), 202))
  app.get('/v1/operations/:id', async c => c.json(await service.get(c.get('principal'), id.parse(c.req.param('id')))))
  app.get('/v1/operations/:id/authorization', async c => c.json(await service.authorization(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/v1/operations/:id/approve', async c => {
    const body = approvalInput.parse(await c.req.json())
    return c.json(await service.decide(c.get('principal'), id.parse(c.req.param('id')), body.operationHash, true, body.signature))
  })
  app.post('/v1/operations/:id/reject', async c => {
    const body = approvalInput.parse(await c.req.json())
    return c.json(await service.decide(c.get('principal'), id.parse(c.req.param('id')), body.operationHash, false))
  })
  // Old routes are not mounted. No compatibility proxy can reach an old signer.
  app.notFound(c => c.json({ error: { code: 'route_unavailable', message: 'Legacy endpoints removed. Use /v1; unmigrated capabilities are unavailable.' } }, 404))
  return app
}

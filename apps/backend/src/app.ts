import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { approvalInput, grantInput, walletPolicy } from '@agentis-hq/core/operations'
import { grants, wallets } from './db/schema'
import { ApiError, fail } from './errors'
import { hash, OperationService, type Principal } from './operations'
import { defaultProductChain, supportedNetworks } from './modules/networks'
import { onboardingRoutes } from './modules/onboarding'

export type Identity = {
  authenticate(token: string): Promise<string>
  createWallet?(ownerId: string, chainType: 'ethereum' | 'solana', agentId?: string): Promise<{ providerWalletId: string; address: string; chainType: string; serverAuthorized?: boolean }>
  enableServerExecution?(id: string, ownerId: string, userJwt: string): Promise<{ serverAuthorized: boolean }>
  inspectWallet?(id: string, ownerId: string): Promise<{ providerWalletId: string; address: string; chainType: string }>
}
const id = z.string().uuid()
export function createApp(service: OperationService, identity: Identity, origins: string[]) {
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.use('*', bodyLimit({ maxSize: 32 * 1024 }))
  app.use('*', cors({ origin: origins, allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: { code: 'invalid_request', message: 'Invalid request body or parameters' } }, 400)
    // Do not put SQL, provider payloads or credentials in public errors/logs.
    return c.json({ error: { code: 'internal_error', message: 'Request failed; retry with the same idempotency key if applicable' } }, 500)
  })
  app.get('/health', c => c.json({ status: 'ok', version: 'rewrite', execution: service.executor?.id ?? 'disabled' }))
  app.use('/v1/*', async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token) fail(401, 'unauthorized', 'Bearer token required')
    if (token.startsWith('agt_exec_')) {
      const [grant] = await service.db.select().from(grants).where(eq(grants.tokenHash, hash(token)))
      if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) fail(401, 'unauthorized', 'Inactive executor grant')
      c.set('principal', { kind: 'agent', ownerId: grant.ownerId, grantId: grant.id })
    } else {
      let ownerId: string
      try { ownerId = await identity.authenticate(token) } catch { fail(401, 'unauthorized', 'Invalid owner token') }
      c.set('principal', { kind: 'owner', ownerId })
    }
    await next()
  })
  app.route('/v1', onboardingRoutes(service, identity))
  app.get('/v1/capabilities', c => c.json({ defaultChain: defaultProductChain, networks: Object.fromEntries(supportedNetworks.map(network => [network.chainId, { name: network.name, testnet: network.testnet, execution: service.executor?.id === 'privy' && ['base', 'arc'].includes(network.key) }])), core: { transfers: !!service.executor, x402: false, mpp: false }, plugins: service.config, executor: service.executor?.id ?? null, approvalSecurity: service.executor?.id === 'anvil' ? 'local-demo-app-authorization' : service.executor?.id === 'privy' ? 'backend-policy-and-owner-approval' : 'live-execution-unavailable' }))
  app.get('/v1/wallets', async c => {
    const principal = c.get('principal')
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Wallet administration requires owner access')
    return c.json(await service.db.select({ id: wallets.id, agentId: wallets.agentId, address: wallets.address, chainId: wallets.chainId, policy: wallets.policy, policyVersion: wallets.policyVersion, enabled: wallets.enabled, serverAuthorized: wallets.serverAuthorized }).from(wallets).where(eq(wallets.ownerId, principal.ownerId)))
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
  app.patch('/v1/wallets/:id/policy', async c => {
    const result = await service.setPolicy(c.get('principal'), id.parse(c.req.param('id')), await c.req.json())
    return c.json({ id: result.id, policy: result.policy, policyVersion: result.policyVersion })
  })
  app.post('/v1/grants', async c => c.json(await service.createGrant(c.get('principal'), grantInput.parse(await c.req.json())), 201))
  app.delete('/v1/grants/:id', async c => { await service.revoke(c.get('principal'), id.parse(c.req.param('id'))); return c.body(null, 204) })
  app.get('/v1/operations', async c => c.json(await service.list(c.get('principal'))))
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

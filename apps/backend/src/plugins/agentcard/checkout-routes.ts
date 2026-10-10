import { Hono } from 'hono'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Principal } from '../../operations'
import { agents, cardCheckouts, cardCheckoutPermissions, cardVaults, grants } from '../../db/schema'
import { fail } from '../../errors'
import type { AgentcardService } from './service'

const id = z.string().uuid()
export function cardCheckoutRoutes(plugin: AgentcardService) {
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.post('/', async c => {
    const result = await plugin.create(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? '')
    return c.json(result, result.newlyCreated ? 201 : 200)
  })
  app.get('/registry', async c => c.json(await plugin.browserRegistry(c.get('principal'), id.parse(c.req.query('agentId')))))
  app.post('/:id/browser-step', async c => {
    const input = z.object({ step: z.enum(['continuations', 'duplicate-guard']), body: z.record(z.string(), z.unknown()) }).strict().parse(await c.req.json())
    return c.json(await plugin.browserStep(c.get('principal'), id.parse(c.req.param('id')), input.step, input.body))
  })
  app.get('/', async c => c.json(await plugin.list(c.get('principal'), id.parse(c.req.query('agentId')))))
  app.get('/:id', async c => c.json(await plugin.get(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/:id/decide', async c => {
    const input = z.object({ operationHash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.boolean(), confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await plugin.decide(c.get('principal'), id.parse(c.req.param('id')), input.operationHash, input.approve))
  })
  app.post('/:id/execute', async c => c.json(await plugin.execute(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/:id/cancel', async c => c.json(await plugin.cancel(c.get('principal'), id.parse(c.req.param('id')))))
  app.get('/:id/replay', async c => c.json(await plugin.replay(c.get('principal'), id.parse(c.req.param('id')))))
  return app
}
export function cardPurchaseRoutes(plugin: AgentcardService) {
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.post('/ask', async c => c.json(await plugin.askPurchase(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? '')))
  app.get('/conversations/:id', async c => c.json(await plugin.purchaseConversation(c.get('principal'), id.parse(c.req.param('id')))))
  app.post('/confirm', async c => c.json(await plugin.confirmPurchase(c.get('principal'), await c.req.json(), c.req.header('Idempotency-Key') ?? '')))
  app.post('/:id/continue', async c => {
    z.object({ confirm: z.literal(true) }).strict().parse(await c.req.json())
    return c.json(await plugin.continuePurchase(c.get('principal'), id.parse(c.req.param('id'))))
  })
  return app
}
/** Mounted only AFTER the parent owner middleware. Fiat consent is separate from network grants. */
export function cardPermissionRoutes(plugin: AgentcardService) {
  const { service, provider } = plugin
  const app = new Hono<{ Variables: { principal: Principal } }>()
  app.use('*', async (c, next) => { if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can grant card access'); await next() })
  app.get('/', async c => {
    const principal = c.get('principal'), agentId = id.parse(c.req.query('agentId'))
    const [agent] = await service.db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerId, principal.ownerId)))
    if (!agent) fail(404, 'not_found', 'Agent not found')
    const rows = await service.db.select({ grantId: cardCheckoutPermissions.grantId, enabled: cardCheckoutPermissions.enabled, revision: cardCheckoutPermissions.revision }).from(cardCheckoutPermissions).innerJoin(cardVaults, eq(cardVaults.id, cardCheckoutPermissions.vaultId)).where(and(eq(cardCheckoutPermissions.ownerId, principal.ownerId), eq(cardCheckoutPermissions.agentId, agentId), eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, provider?.fingerprint ?? 'unconfigured')))
    return c.json(rows)
  })
  app.post('/', async c => {
    const principal = c.get('principal')
    const input = z.object({ grantId: id, enabled: z.boolean(), confirm: z.literal(true), scope: z.literal('card_purchases_follow_agent_policy') }).strict().parse(await c.req.json())
    return c.json(await service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      const [grant] = await tx.select().from(grants).where(and(eq(grants.id, input.grantId), eq(grants.ownerId, principal.ownerId)))
      if (!grant?.agentId) fail(404, 'not_found', 'An agent-scoped key is required')
      const [vault] = provider ? await tx.select().from(cardVaults).where(and(eq(cardVaults.ownerId, principal.ownerId), eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, provider.fingerprint))) : []
      const [existing] = await tx.select().from(cardCheckoutPermissions).where(eq(cardCheckoutPermissions.grantId, input.grantId))
      if (!vault && !existing) fail(409, 'vault_required', 'Connect your Vault first')
      if (input.enabled) {
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, grant.agentId), eq(agents.ownerId, principal.ownerId)))
        if (!agent?.plugins.includes('agentcard')) fail(403, 'plugin_disabled', 'Enable the Agentcard plugin for this agent first')
        if (!plugin.enabled || !provider) fail(503, 'checkout_disabled', 'Card checkout preview is disabled')
        if (grant.revokedAt || (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())) fail(409, 'grant_inactive', 'Key is inactive')
        if (!vault || vault.disconnectedAt) fail(409, 'vault_required', 'Connect your Vault first')
      }
      const values = { grantId: grant.id, ownerId: principal.ownerId, agentId: grant.agentId, vaultId: vault?.id ?? existing!.vaultId, enabled: input.enabled, revision: (existing?.revision ?? 0) + 1 }
      if (existing) await tx.update(cardCheckoutPermissions).set(values).where(eq(cardCheckoutPermissions.grantId, grant.id))
      else await tx.insert(cardCheckoutPermissions).values(values)
      await tx.update(cardCheckouts).set({ status: 'rejected', error: 'Card permission changed' }).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.grantId, grant.id), inArray(cardCheckouts.status, ['pending_approval', 'queued'])))
      // Already dispatched requests retain their holds; the reconciler attempts cancellation, then reads settlement.
      await tx.update(cardCheckouts).set({ cancelRequested: true, encryptedApprovalUrl: null }).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.grantId, grant.id), inArray(cardCheckouts.status, ['submitting', 'awaiting_provider', 'unknown'])))
      return { grantId: values.grantId, enabled: values.enabled, revision: values.revision }
    }))
  })
  return app
}

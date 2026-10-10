import { Hono } from 'hono'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { agents, cardSessions, cardVaults, cardCheckouts, cardCheckoutPermissions, grants, wallets } from '../../db/schema'
import { fail } from '../../errors'
import type { Principal } from '../../operations'
import type { AgentcardService } from './service'
import { cardCheckoutRoutes, cardPermissionRoutes, cardPurchaseRoutes } from './checkout-routes'

type Session = typeof cardSessions.$inferSelect
const active = ['creating', 'pending', 'unknown'] as const
const id = z.string().uuid()
const key = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const confirmation = z.object({ confirm: z.literal(true) }).strict()

export function agentcardRoutes(plugin: AgentcardService) {
  const { service, provider } = plugin
  const app = new Hono<{ Variables: { principal: Principal } }>()
  const configured = () => { if (!provider) fail(503, 'cards_not_configured', 'Card connections are not configured on this server'); return provider }
  const scoped = (ownerId: string) => and(eq(cardSessions.ownerId, ownerId), eq(cardSessions.provider, 'agentcard'), eq(cardSessions.clientFingerprint, configured().fingerprint))
  const vaultScope = (ownerId: string) => and(eq(cardVaults.ownerId, ownerId), eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, configured().fingerprint))
  const lock = async (tx: Parameters<Parameters<typeof service.db.transaction>[0]>[0], ownerId: string) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${ownerId}`}, 0))`) }
  const view = (row: Session, includeUrl = false) => ({
    id: row.id, status: row.status, expiresAt: row.expiresAt.toISOString(),
    pollAfterMs: Math.max(row.pollInterval * 1000, row.nextPollAt.getTime() - Date.now()),
    ...(includeUrl && row.status === 'pending' && row.encryptedUrl ? { enrollmentUrl: configured().open(row.encryptedUrl, `${row.ownerId}:${row.id}`) } : {}),
  })
  const expire = async (tx: Parameters<Parameters<typeof service.db.transaction>[0]>[0], ownerId: string) => {
    await tx.update(cardSessions).set({ status: 'expired', encryptedUrl: null }).where(and(scoped(ownerId), inArray(cardSessions.status, [...active]), lt(cardSessions.expiresAt, new Date())))
  }

  // Existing executor consent permits a link back to its own agent, NOT card reads or card spending.
  app.get('/status', async c => {
    const principal = c.get('principal'), agentId = id.parse(c.req.query('agentId'))
    const [agent] = await service.db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerId, principal.ownerId)))
    if (!agent) fail(404, 'not_found', 'Agent not found')
    if (principal.kind === 'agent') {
      const [grant] = await service.db.select().from(grants).where(and(eq(grants.id, principal.grantId), eq(grants.ownerId, principal.ownerId)))
      if (!grant || grant.revokedAt || (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())) fail(403, 'grant_inactive', 'Executor grant is inactive')
      const [wallet] = grant.walletId ? await service.db.select().from(wallets).where(and(eq(wallets.id, grant.walletId), eq(wallets.ownerId, principal.ownerId))) : []
      if ((grant.agentId ?? wallet?.agentId) !== agentId) fail(404, 'not_found', 'Agent not found')
    }
    const url = new URL(`/dashboard/agents/${agentId}`, service.dashboardUrl); url.hash = agent.plugins.includes('agentcard') ? 'plugin-agentcard' : 'agent-plugins-title'
    const pluginEnabled = agent.plugins.includes('agentcard')
    return c.json({ provider: 'agentcard', pluginEnabled, configured: Boolean(provider), checkoutEnabled: pluginEnabled && plugin.enabled, purchaseApiEnabled: pluginEnabled && plugin.enabled, setupUrl: url.href })
  })
  app.route('/checkouts', cardCheckoutRoutes(plugin))
  app.route('/purchases', cardPurchaseRoutes(plugin))
  app.use('*', async (c, next) => {
    if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can connect or inspect vaulted cards. Crypto executor grants do not authorize card access.')
    await next()
  })
  app.route('/permissions', cardPermissionRoutes(plugin))
  app.get('/', async c => {
    if (!provider) return c.json({ provider: 'agentcard', configured: false, connected: false, testMode: null, cards: [], session: null, checkoutEnabled: false, purchaseApiEnabled: false })
    const ownerId = c.get('principal').ownerId
    const state = await service.db.transaction(async tx => {
      await lock(tx, ownerId); await expire(tx, ownerId)
      const [vault] = await tx.select().from(cardVaults).where(vaultScope(ownerId))
      const [session] = await tx.select().from(cardSessions).where(and(scoped(ownerId), inArray(cardSessions.status, [...active]))).orderBy(desc(cardSessions.createdAt)).limit(1)
      return { vault, session }
    })
    const connected = Boolean(state.vault && !state.vault.disconnectedAt)
    const cards = connected ? await provider.listCards(state.vault!.userId) : []
    // A concurrent disconnect must not disclose a stale card list.
    const [current] = await service.db.select().from(cardVaults).where(vaultScope(ownerId))
    if (connected && (!current || current.disconnectedAt || current.id !== state.vault!.id)) fail(409, 'vault_disconnected', 'Card connection changed; reload the page')
    return c.json({ provider: 'agentcard', configured: true, connected, testMode: connected ? state.vault!.testMode : null, cards, session: state.session ? view(state.session) : null, checkoutEnabled: plugin.enabled, purchaseApiEnabled: plugin.enabled })
  })
  app.post('/sessions', async c => {
    confirmation.parse(await c.req.json())
    const idempotencyKey = key.parse(c.req.header('Idempotency-Key')), ownerId = c.get('principal').ownerId, api = configured()
    const claimed = await service.db.transaction(async tx => {
      await lock(tx, ownerId); await expire(tx, ownerId)
      const [existing] = await tx.select().from(cardSessions).where(and(scoped(ownerId), eq(cardSessions.idempotencyKey, idempotencyKey)))
      if (existing) return { row: existing, create: false }
      const [pending] = await tx.select().from(cardSessions).where(and(scoped(ownerId), inArray(cardSessions.status, [...active]))).limit(1)
      if (pending) fail(409, 'card_session_pending', 'An enrollment already exists. Resume it, or wait for expiry; do not create another link.')
      const [recent] = await tx.select({ count: sql<number>`count(*)::int` }).from(cardSessions).where(and(scoped(ownerId), sql`${cardSessions.createdAt} > now() - interval '24 hours'`))
      if (recent!.count >= 10) fail(429, 'card_session_limit', 'Too many enrollment requests; try again tomorrow')
      const [vault] = await tx.select().from(cardVaults).where(vaultScope(ownerId))
      const [row] = await tx.insert(cardSessions).values({ ownerId, clientFingerprint: api.fingerprint, idempotencyKey, status: 'creating', expectedUserId: vault?.userId, expiresAt: new Date(Date.now() + 1_260_000) }).returning()
      return { row: row!, create: true }
    })
    if (!claimed.create) return c.json(view(claimed.row, true))
    // Durable claim before the one provider POST. A timeout/DB failure never causes an automatic repeat.
    try {
      const result = await api.createSession(claimed.row.expectedUserId ?? undefined)
      const expiry = new Date(result.expires_at)
      if (expiry.getTime() <= Date.now() || expiry.getTime() > claimed.row.expiresAt.getTime()) fail(502, 'invalid_card_session', 'Unexpected enrollment lifetime')
      const encryptedUrl = api.seal(result.url, `${ownerId}:${claimed.row.id}`)
      const row = await service.db.transaction(async tx => {
        await lock(tx, ownerId)
        const [updated] = await tx.update(cardSessions).set({ providerSessionId: result.id, encryptedUrl, status: 'pending', testMode: result.test_mode, expiresAt: expiry, pollInterval: result.poll_interval, nextPollAt: new Date(Date.now() + result.poll_interval * 1000) }).where(and(scoped(ownerId), eq(cardSessions.id, claimed.row.id), eq(cardSessions.status, 'creating'))).returning()
        if (!updated) fail(409, 'card_session_cancelled', 'Enrollment was disconnected while the provider request was in progress')
        return updated
      })
      return c.json(view(row, true), 201)
    } catch {
      await service.db.update(cardSessions).set({ status: 'unknown' }).where(and(scoped(ownerId), eq(cardSessions.id, claimed.row.id), eq(cardSessions.status, 'creating')))
      fail(502, 'card_session_unknown', 'Enrollment result is uncertain. Reuse the same key or inspect the existing request; do not start another enrollment before expiry.')
    }
  })
  app.get('/sessions/:id', async c => {
    const ownerId = c.get('principal').ownerId, sessionId = id.parse(c.req.param('id')), api = configured()
    const claimed = await service.db.transaction(async tx => {
      await lock(tx, ownerId); await expire(tx, ownerId)
      const [row] = await tx.select().from(cardSessions).where(and(scoped(ownerId), eq(cardSessions.id, sessionId)))
      if (!row) fail(404, 'not_found', 'Enrollment not found')
      if (row.status !== 'pending' || !row.providerSessionId || row.nextPollAt.getTime() > Date.now()) return { row, poll: false }
      await tx.update(cardSessions).set({ nextPollAt: new Date(Date.now() + Math.max(15, row.pollInterval) * 1000) }).where(eq(cardSessions.id, row.id))
      return { row, poll: true }
    })
    if (!claimed.poll) return c.json(view(claimed.row, true))
    const result = await api.readSession(claimed.row.providerSessionId!)
    if (result.id !== claimed.row.providerSessionId || result.test_mode !== claimed.row.testMode || (claimed.row.expectedUserId && result.user_id !== claimed.row.expectedUserId)) fail(502, 'invalid_card_session', 'Enrollment identity or environment changed')
    return c.json(await service.db.transaction(async tx => {
      await lock(tx, ownerId)
      const [row] = await tx.select().from(cardSessions).where(and(scoped(ownerId), eq(cardSessions.id, sessionId)))
      if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= Date.now()) fail(409, 'card_session_changed', 'Enrollment changed; reload its status')
      if (result.status === 'linked') {
        if (!result.user_id) fail(502, 'invalid_card_user', 'Enrollment did not return a connected account')
        // Serialize even when two distinct Agentis owners try to bind the same provider user.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`card-user:${api.fingerprint}:${result.user_id}`}, 0))`)
        const [other] = await tx.select().from(cardVaults).where(and(eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, api.fingerprint), eq(cardVaults.userId, result.user_id)))
        if (other && other.ownerId !== ownerId) fail(409, 'card_account_unavailable', 'This Vault account cannot be connected here')
        const [vault] = await tx.select().from(cardVaults).where(vaultScope(ownerId))
        if (vault && (vault.userId !== result.user_id || vault.testMode !== result.test_mode)) fail(409, 'card_account_changed', 'Existing Vault account differs from this enrollment')
        if (vault) await tx.update(cardVaults).set({ disconnectedAt: null, linkedAt: new Date() }).where(eq(cardVaults.id, vault.id))
        else await tx.insert(cardVaults).values({ ownerId, clientFingerprint: api.fingerprint, userId: result.user_id, testMode: result.test_mode })
      }
      const [updated] = await tx.update(cardSessions).set({ status: result.status, pollInterval: result.poll_interval, nextPollAt: new Date(Date.now() + result.poll_interval * 1000), ...(result.status !== 'pending' ? { encryptedUrl: null } : {}) }).where(eq(cardSessions.id, row.id)).returning()
      return view(updated!, true)
    }))
  })
  app.post('/disconnect', async c => {
    confirmation.parse(await c.req.json())
    const ownerId = c.get('principal').ownerId; configured()
    await service.db.transaction(async tx => {
      await lock(tx, ownerId)
      await tx.update(cardVaults).set({ disconnectedAt: new Date() }).where(vaultScope(ownerId))
      const permissions = await tx.select({ grantId: cardCheckoutPermissions.grantId }).from(cardCheckoutPermissions).innerJoin(cardVaults, eq(cardVaults.id, cardCheckoutPermissions.vaultId)).where(and(eq(cardCheckoutPermissions.ownerId, ownerId), vaultScope(ownerId)))
      if (permissions.length) await tx.update(cardCheckoutPermissions).set({ enabled: false, revision: sql`${cardCheckoutPermissions.revision} + 1` }).where(inArray(cardCheckoutPermissions.grantId, permissions.map(row => row.grantId)))
      await tx.update(cardCheckouts).set({ status: 'rejected', error: 'Vault disconnected' }).where(and(eq(cardCheckouts.ownerId, ownerId), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.clientFingerprint, configured().fingerprint), inArray(cardCheckouts.status, ['pending_approval', 'queued'])))
      await tx.update(cardCheckouts).set({ cancelRequested: true, encryptedApprovalUrl: null }).where(and(eq(cardCheckouts.ownerId, ownerId), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.clientFingerprint, configured().fingerprint), inArray(cardCheckouts.status, ['submitting', 'awaiting_provider', 'unknown'])))
      await tx.update(cardSessions).set({ status: 'cancelled', encryptedUrl: null }).where(and(scoped(ownerId), inArray(cardSessions.status, [...active])))
    })
    return c.json({ disconnected: true, providerPermissionsRevoked: false })
  })
  return app
}

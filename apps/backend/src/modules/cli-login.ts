import { Hono } from 'hono'
import { and, eq, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { agents, cliLogins, wallets } from '../db/schema'
import { hash, type OperationService, type Principal } from '../operations'
import { fail } from '../errors'

const id = z.string().uuid()
const selections = z.array(z.object({ agentId: id, chainIds: z.array(z.string().min(1).max(100)).min(1).max(5).refine(chains => new Set(chains).size === chains.length) }).strict()).min(1).max(20).refine(items => new Set(items.map(item => item.agentId)).size === items.length)

export function cliLoginRoutes(service: OperationService) {
  const publicRoutes = new Hono()
  const ownerRoutes = new Hono<{ Variables: { principal: Principal } }>()
  publicRoutes.post('/', async c => {
    const input = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await c.req.json())
    const row = await service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('cli-login-start', 0))`)
      await tx.delete(cliLogins).where(lt(cliLogins.expiresAt, new Date()))
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(cliLogins)
      if (count!.total >= 1000) fail(429, 'login_busy', 'Too many recent logins; try again shortly')
      const [created] = await tx.insert(cliLogins).values({ challenge: input.challenge, expiresAt: new Date(Date.now() + 600_000) }).returning()
      return created!
    })
    const url = new URL('/cli-auth', service.dashboardUrl)
    url.searchParams.set('request', row!.id)
    return c.json({ id: row!.id, approvalUrl: url.href, code: row!.challenge.slice(0, 8).toUpperCase(), expiresAt: row!.expiresAt.toISOString() }, 201)
  })
  publicRoutes.post('/:id/exchange', async c => {
    const requestId = id.parse(c.req.param('id'))
    const { secret } = z.object({ secret: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await c.req.json())
    return c.json(await service.db.transaction(async tx => {
      const [row] = await tx.select().from(cliLogins).where(and(eq(cliLogins.id, requestId), eq(cliLogins.challenge, hash(secret)))).for('update')
      if (!row || row.expiresAt.getTime() <= Date.now()) fail(410, 'login_expired', 'Login expired or invalid; run agentis login again')
      if (row.consumedAt) fail(409, 'login_consumed', 'Login was already exchanged. If its response was lost, revoke the CLI keys in the dashboard and start again')
      if (!row.ownerId || !row.selections) return { status: 'pending' as const }
      const principal: Principal = { kind: 'owner', ownerId: row.ownerId }
      // Same owner lock and grant validation as dashboard key creation; all keys
      // and one-time consumption commit together. No raw keys stored in this table.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${row.ownerId}`}, 0))`)
      const credentials = []
      for (const selection of row.selections) {
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, selection.agentId), eq(agents.ownerId, row.ownerId)))
        if (!agent) fail(409, 'agent_unavailable', 'A selected agent is no longer available; start login again')
        const grant = await service.createGrant(principal, { ...selection, agentName: `CLI · ${agent.name}`.slice(0, 80) }, tx)
        credentials.push({ id: grant.id, agentId: agent.id, agentName: agent.name, chainIds: grant.chainIds!, token: grant.token })
      }
      if (row.expiresAt.getTime() <= Date.now()) fail(410, 'login_expired', 'Login expired; start again')
      await tx.update(cliLogins).set({ consumedAt: new Date() }).where(eq(cliLogins.id, row.id))
      return { status: 'complete' as const, credentials }
    }))
  })
  ownerRoutes.use('*', async (c, next) => {
    if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can connect a CLI')
    await next()
  })
  ownerRoutes.get('/:id', async c => {
    const [row] = await service.db.select().from(cliLogins).where(eq(cliLogins.id, id.parse(c.req.param('id'))))
    if (!row || row.expiresAt.getTime() <= Date.now()) fail(410, 'login_expired', 'Login expired; run agentis login again')
    if (row.ownerId && row.ownerId !== c.get('principal').ownerId) fail(404, 'not_found', 'Login not found')
    return c.json({ code: row.challenge.slice(0, 8).toUpperCase(), expiresAt: row.expiresAt.toISOString(), approved: row.ownerId !== null })
  })
  ownerRoutes.post('/:id/approve', async c => {
    const input = z.object({ selections, code: z.string().regex(/^[A-F0-9]{8}$/), confirm: z.literal(true) }).strict().parse(await c.req.json())
    const ownerId = c.get('principal').ownerId
    await service.db.transaction(async tx => {
      const [row] = await tx.select().from(cliLogins).where(eq(cliLogins.id, id.parse(c.req.param('id')))).for('update')
      if (!row || row.expiresAt.getTime() <= Date.now()) fail(410, 'login_expired', 'Login expired; run agentis login again')
      if (row.ownerId || row.consumedAt) fail(409, 'login_approved', 'This login has already been approved')
      if (input.code !== row.challenge.slice(0, 8).toUpperCase()) fail(400, 'code_mismatch', 'Confirmation code does not match the CLI')
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${ownerId}`}, 0))`)
      for (const selection of input.selections) {
        const enabled = await tx.select().from(wallets).where(and(eq(wallets.ownerId, ownerId), eq(wallets.agentId, selection.agentId), eq(wallets.enabled, true)))
        if (selection.chainIds.some(chain => !enabled.some(wallet => wallet.chainId === chain))) fail(400, 'invalid_network_scope', 'Choose enabled wallets belonging to your agents')
      }
      if (row.expiresAt.getTime() <= Date.now()) fail(410, 'login_expired', 'Login expired; start again')
      await tx.update(cliLogins).set({ ownerId, selections: input.selections }).where(eq(cliLogins.id, row.id))
    })
    return c.json({ approved: true })
  })
  return { publicRoutes, ownerRoutes }
}

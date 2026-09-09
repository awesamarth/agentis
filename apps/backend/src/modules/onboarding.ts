import { isDeepStrictEqual } from 'node:util'
import { Hono, type Handler } from 'hono'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { formatUnits, parseUnits } from 'viem'
import { agentSettings, walletPolicy, type UsdLimits } from '@agentis-hq/core/operations'
import { onboarding, wallets, operations, agents } from '../db/schema'
import type { OperationService, Principal } from '../operations'
import type { Identity } from '../app'
import { fail } from '../errors'
import { networkSelection, supportedNetworks } from './networks'

type Env = { Variables: { principal: Principal } }
const view = (agent: typeof agents.$inferSelect) => ({ ...agent, limits: Object.fromEntries(Object.entries(agent.limits).map(([key, value]) => [key, value === null ? null : formatUnits(BigInt(value), 6)])) as UsdLimits })
export function onboardingRoutes(service: OperationService, identity: Identity) {
  const app = new Hono<Env>()
  const ownerOnly: Handler<Env> = async (c, next) => { if (c.get('principal').kind !== 'owner') fail(403, 'owner_required', 'Only the owner can manage agents'); await next() }
  app.use('/onboarding', ownerOnly)
  app.use('/agents', ownerOnly)
  app.use('/agents/*', ownerOnly)
  app.get('/onboarding', async c => {
    const [saved] = await service.db.select().from(onboarding).where(eq(onboarding.ownerId, c.get('principal').ownerId))
    return c.json({ settings: saved ? { networks: saved.networks, defaultNetwork: saved.defaultNetwork, totalBudgetUsd: saved.totalBudgetUsdMicros === null ? null : formatUnits(BigInt(saved.totalBudgetUsdMicros), 6), completedAt: saved.completedAt.toISOString() } : null, networks: supportedNetworks.map(network => ({ ...network, executionReady: service.executor?.id === 'privy' && ['base', 'arc', 'tempo', 'solana'].includes(network.key) })) })
  })
  app.get('/agents', async c => c.json((await service.db.select().from(agents).where(eq(agents.ownerId, c.get('principal').ownerId))).map(view)))
  const save: Handler<Env> = async c => {
    const creating = c.req.method === 'POST'
    const input = agentSettings.extend({ id: z.string().uuid(), selection: networkSelection, enableExecution: z.boolean().default(false) }).strict().parse({ ...await c.req.json(), ...(!creating ? { id: c.req.param('id') } : {}) })
    const ownerId = c.get('principal').ownerId
    return c.json(await service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${ownerId}`}, 0))`)
      const [currentAgent] = await tx.select().from(agents).where(and(eq(agents.id, input.id), eq(agents.ownerId, ownerId))).for('update')
      if (!creating && !currentAgent) fail(404, 'not_found', 'Agent not found')
      const values = { id: input.id, ownerId, name: input.name, mode: input.mode, allowedRecipients: input.allowedRecipients, networks: input.selection.networks, defaultNetwork: input.selection.defaultNetwork, limits: Object.fromEntries(Object.entries(input.limits).map(([key, value]) => [key, value === null ? null : parseUnits(value, 6).toString()])) as UsdLimits }
      if (creating && currentAgent) {
        if (!isDeepStrictEqual(currentAgent, values)) fail(409, 'agent_exists', 'Agent already exists; edit its settings instead')
        return view(currentAgent)
      }
      if (!creating && currentAgent && !input.enableExecution && isDeepStrictEqual({ ...currentAgent, name: values.name }, values)) {
        await tx.update(agents).set({ name: values.name }).where(and(eq(agents.id, input.id), eq(agents.ownerId, ownerId)))
        return view(values)
      }
      const existing = await tx.select().from(wallets).where(and(eq(wallets.ownerId, ownerId), eq(wallets.agentId, input.id))).orderBy(wallets.id).for('update')
      if (existing.length) {
        const unsettled = await tx.select().from(operations).where(and(inArray(operations.walletId, existing.map(wallet => wallet.id)), inArray(operations.status, ['submitting', 'submitted', 'unknown'])))
        if (unsettled.some(row => row.usdQuote === null)) fail(409, 'settlement_required', 'Resolve earlier payments before changing this agent’s budget')
      }
      if (creating) await tx.insert(agents).values(values)
      else await tx.update(agents).set(values).where(eq(agents.id, input.id))
      const selected = supportedNetworks.filter(network => input.selection.networks.includes(network.key))
      const provisioned = new Map<string, { providerWalletId: string; address: string; chainType: string; serverAuthorized?: boolean }>()
      for (const wallet of existing) {
        const network = supportedNetworks.find(network => network.chainId === wallet.chainId)
        if (network) provisioned.set(network.chainType, { providerWalletId: wallet.providerWalletId, address: wallet.address, chainType: network.chainType, serverAuthorized: wallet.serverAuthorized })
      }
      const authorized = new Map<string, boolean>()
      for (const network of selected) {
        const current = existing.find(wallet => wallet.chainId === network.chainId)
        const policy = walletPolicy.parse({ maxPerOperationAtomic: '0', maxDailyAtomic: '0', maxLifetimeAtomic: '0', budgetMode: 'usd', ...current?.policy, mode: input.mode, allowedRecipients: input.allowedRecipients })
        let checked = current ? { ...current, chainType: network.chainType } : provisioned.get(network.chainType)
        if (!checked) {
          if (!identity.createWallet) fail(503, 'provider_unavailable', 'Hosted wallet creation is unavailable')
          checked = await identity.createWallet(ownerId, network.chainType, input.id)
        }
        provisioned.set(network.chainType, checked)
        if (checked.chainType !== network.chainType) throw new Error('Provider returned wrong wallet type')
        if (!authorized.has(checked.providerWalletId)) {
          // Rules are local; ownership is checked again before payment execution.
          const result = checked.serverAuthorized ? checked : await identity.enableServerExecution?.(checked.providerWalletId, ownerId, c.req.header('authorization')!.slice(7))
          authorized.set(checked.providerWalletId, result?.serverAuthorized ?? false)
        }
        const serverAuthorized = authorized.get(checked.providerWalletId)!
        if (current) await tx.update(wallets).set({ enabled: true, serverAuthorized, policy, policyVersion: current.policyVersion + 1 }).where(eq(wallets.id, current.id))
        else await tx.insert(wallets).values({ ownerId, agentId: input.id, provider: 'privy', providerWalletId: checked.providerWalletId, address: checked.address, chainId: network.chainId, policy, serverAuthorized })
      }
      for (const current of existing) {
        if (!selected.some(network => network.chainId === current.chainId)) await tx.update(wallets).set({ enabled: false, policyVersion: current.policyVersion + 1 }).where(eq(wallets.id, current.id))
        await tx.update(operations).set({ status: 'denied', authorizationSignature: null, error: 'Agent rules changed; request a new payment' }).where(and(eq(operations.walletId, current.id), inArray(operations.status, ['pending_approval', 'queued'])))
      }
      await tx.insert(onboarding).values({ ownerId, networks: values.networks, defaultNetwork: values.defaultNetwork }).onConflictDoNothing()
      return view(values)
    }))
  }
  app.post('/agents', save)
  app.patch('/agents/:id', save)
  return app
}

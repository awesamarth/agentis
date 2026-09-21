import { isDeepStrictEqual } from 'node:util'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { erc20Abi, formatUnits, type Address } from 'viem'
import { z } from 'zod'
import type { OperationService, Principal } from '../../operations'
import { hash } from '../../operations'
import { fetchRequest, operationInput, type FetchRequest, type OperationInput } from '@agentis-hq/core/operations'
import { discoverX402 } from '../../modules/x402'
import { agents, wallets, uniswapTargets, operations as operationRows, uniswapPlans as plans, uniswapSchedules as schedules, uniswapSetupRequests as setupRequests } from '../../db/schema'
import { fail } from '../../errors'
import { evmClient } from '../../modules/networks'
import { quoteUsd } from '../../modules/usd-budget'
import { quoteSwap, swapRequest, swapInput, uniswap, tokenUnits, type SwapRequest } from './swap'

type Tx = Parameters<Parameters<OperationService['db']['transaction']>[0]>[0]
type Plan = typeof plans.$inferSelect
const keyFor = (p: Principal) => p.kind === 'owner' ? `owner:${p.ownerId}` : `grant:${p.grantId}`
const failed = new Set(['failed', 'denied', 'expired', 'rejected'])
export const scheduleInput = z.object({ id: z.string().uuid().optional(), request: swapRequest, intervalMinutes: z.number().int().min(5).max(525600), kind: z.enum(['dca', 'gas_refill']).default('dca'), minimumGas: z.string().optional(), confirm: z.literal(true) }).strict()
export type ScheduleInput = z.infer<typeof scheduleInput>
export class UniswapService {
  quoteSource = quoteSwap
  constructor(readonly service: OperationService) {}
  async wallet(principal: Principal, walletId: string, requirePlugin = true) {
    const policy = await this.service.policyView(principal, walletId)
    const [wallet] = await this.service.db.select().from(wallets).where(eq(wallets.id, walletId))
    const [agent] = await this.service.db.select().from(agents).where(eq(agents.id, policy.agentId))
    if (!wallet || !agent || wallet.chainId !== uniswap.chainId) fail(400, 'unsupported_network', 'Select a Base Sepolia wallet')
    if (requirePlugin && !agent.plugins.includes('uniswap')) fail(403, 'plugin_disabled', 'Enable Uniswap for this agent in the dashboard')
    return { wallet, agent }
  }
  async reason(tx: Tx, wallet: typeof wallets.$inferSelect, input: OperationInput) {
    if (!input.swap) return null
    const [agent] = wallet.agentId ? await tx.select().from(agents).where(eq(agents.id, wallet.agentId)) : []
    if (!agent?.plugins.includes('uniswap')) return 'Uniswap is disabled for this agent'
    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.swap.planId))
    if (!plan || plan.walletId !== wallet.id || plan.ownerId !== wallet.ownerId || plan.status !== 'pending' || plan.expiresAt.getTime() <= Date.now()) return 'Swap plan is inactive or expired'
    if (!isDeepStrictEqual(input, operationInput.parse(swapInput(plan.id, wallet.id, wallet.address, plan.request, plan.quote, input.action === 'uniswap_approval')))) return 'Swap terms differ from the stored plan'
    if (plan.scheduleId) {
      const [schedule] = await tx.select().from(schedules).where(eq(schedules.id, plan.scheduleId))
      if (!schedule || schedule.status !== 'active' || schedule.version !== plan.scheduleVersion) return 'Schedule changed or paused'
    }
    return null
  }
  async quote(principal: Principal, raw: unknown) {
    const request = swapRequest.parse(raw)
    await this.wallet(principal, request.walletId)
    return this.quoteSource(request)
  }
  async create(principal: Principal, raw: unknown, key: string, schedule?: { id: string; version: number }, fundingRequest?: FetchRequest, intentHash?: string) {
    const request = swapRequest.parse(raw), principalKey = keyFor(principal), requestHash = intentHash ?? hash(JSON.stringify(fundingRequest ? { funding: fundingRequest } : request))
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail(400, 'idempotency_required', 'Provide a stable Idempotency-Key')
    const { wallet, agent } = await this.wallet(principal, request.walletId)
    const [existing] = await this.service.db.select().from(plans).where(and(eq(plans.principalKey, principalKey), eq(plans.idempotencyKey, key)))
    if (existing) {
      if (existing.requestHash !== requestHash) fail(409, 'idempotency_conflict', 'This key belongs to different swap terms')
      return this.get(principal, existing.id)
    }
    if (agent.mode === 'paused') fail(409, 'agent_paused', 'Agent is paused')
    const quote = await this.quoteSource(request)
    const row = await this.service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      const [created] = await tx.insert(plans).values({ ownerId: principal.ownerId, agentId: agent.id, walletId: wallet.id, principalKey, grantId: principal.kind === 'agent' ? principal.grantId : null, idempotencyKey: key, requestHash, request, quote, fundingRequest, expiresAt: new Date(quote.expiresAt), scheduleId: schedule?.id, scheduleVersion: schedule?.version }).onConflictDoNothing().returning()
      const saved = created ?? (await tx.select().from(plans).where(and(eq(plans.principalKey, principalKey), eq(plans.idempotencyKey, key))))[0]!
      if (saved.requestHash !== requestHash) fail(409, 'idempotency_conflict', 'This key belongs to different swap terms')
      return saved
    })
    await this.progress(row)
    return this.get(principal, row.id)
  }
  async get(principal: Principal, id: string) {
    const [plan] = await this.service.db.select().from(plans).where(and(eq(plans.id, id), eq(plans.ownerId, principal.ownerId)))
    if (!plan || (principal.kind === 'agent' && plan.grantId !== principal.grantId)) fail(404, 'not_found', 'Swap not found')
    await this.wallet(principal, plan.walletId, false)
    const operations = await Promise.all([plan.approvalId, plan.swapId, plan.paymentId].filter((id): id is string => !!id).map(id => this.service.get(principal, id)))
    return { ...plan, operations, payment: operations.find(op => op.id === plan.paymentId) ?? null, approvalUrl: operations.find(op => op.status === 'pending_approval')?.approvalUrl ?? null }
  }
  async progress(plan: Plan) {
    if (plan.status !== 'pending') return
    const principal: Principal = plan.grantId ? { kind: 'agent', ownerId: plan.ownerId, grantId: plan.grantId } : { kind: 'owner', ownerId: plan.ownerId }
    const update = (values: Partial<Plan>) => this.service.db.update(plans).set(values).where(eq(plans.id, plan.id))
    // Reconcile existing work before inspecting plugin/pause/expiry. Never hide submitted work.
    const currentId = plan.paymentId ?? plan.swapId ?? plan.approvalId
    const current = currentId ? await this.service.get(principal, currentId) : null
    if (current) {
      if (failed.has(current.status)) { await update({ status: 'failed', error: current.error ?? current.status }); return }
      if (current.status !== 'confirmed') return
      if (plan.paymentId || (plan.swapId && !plan.fundingRequest)) { await update({ status: 'complete', error: null }); return }
    }
    if (plan.expiresAt.getTime() <= Date.now()) { await update({ status: 'failed', error: 'Swap plan expired; request a fresh quote' }); return }
    try {
      const { wallet, agent } = await this.wallet(principal, plan.walletId)
      if (agent.mode === 'paused') return
      if (plan.scheduleId) {
        const [schedule] = await this.service.db.select().from(schedules).where(eq(schedules.id, plan.scheduleId))
        if (!schedule || schedule.status !== 'active' || schedule.version !== plan.scheduleVersion) { await update({ status: 'cancelled', error: 'Schedule changed' }); return }
      }
      if (plan.swapId && plan.fundingRequest) {
        const payment = await this.service.fetch(principal, plan.fundingRequest, plan.idempotencyKey)
        await update({ paymentId: payment.id }); return
      }
      let approval = false
      if (plan.request.tokenIn === 'USDC') {
        const allowance = await evmClient(uniswap.chainId).readContract({ address: uniswap.USDC, abi: erc20Abi, functionName: 'allowance', args: [wallet.address as Address, uniswap.router] })
        approval = allowance < BigInt(plan.quote.maximumInputAtomic)
        if (approval && plan.approvalId) { await update({ status: 'failed', error: 'Allowance changed after approval; review a new swap' }); return }
      }
      const operation = await this.service.createPluginOperation(principal, swapInput(plan.id, wallet.id, wallet.address, plan.request, plan.quote, approval), `uniswap:${plan.id}:${approval ? 'approval' : 'swap'}`)
      await update(approval ? { approvalId: operation.id } : { swapId: operation.id })
    } catch (error) { await update({ error: error instanceof Error && 'code' in error ? error.message : 'Uniswap preparation unavailable; existing operations will not be resent' }) }
  }
  async fundFetch(principal: Principal, raw: unknown, key: string) {
    const request = fetchRequest.parse(raw), principalKey = keyFor(principal)
    const { wallet } = await this.wallet(principal, request.walletId)
    const [existing] = await this.service.db.select().from(plans).where(and(eq(plans.principalKey, principalKey), eq(plans.idempotencyKey, key)))
    if (existing) {
      if (existing.requestHash !== hash(JSON.stringify({ funding: request }))) fail(409, 'idempotency_conflict', 'Key belongs to different funding terms')
      const funding = await this.get(principal, existing.id)
      return { funding, payment: funding.payment }
    }
    const [paid] = await this.service.db.select({ id: operationRows.id }).from(operationRows).where(and(eq(operationRows.principalKey, principalKey), eq(operationRows.idempotencyKey, key)))
    if (paid) return { funding: null, payment: await this.service.fetch(principal, request, key) }
    const terms = await discoverX402(request, uniswap.chainId)
    if (terms.asset.toLowerCase() !== `erc20:${uniswap.USDC}`) fail(400, 'unsupported_asset', 'Swap funding currently supports Base Sepolia USDC payments')
    const client = evmClient(uniswap.chainId)
    if (await client.getChainId() !== 84532) throw Error('RPC network mismatch')
    const balance = await client.readContract({ address: uniswap.USDC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Address] })
    const missing = BigInt(terms.amountAtomic) - balance
    if (missing <= 0n) return { funding: null, payment: await this.service.fetch(principal, request, key) }
    const funding = await this.create(principal, { walletId: wallet.id, tokenIn: 'ETH', tokenOut: 'USDC', type: 'EXACT_OUTPUT', amount: formatUnits(missing, 6) }, key, undefined, request)
    return { funding, payment: funding.payment }
  }
  async listSchedules(principal: Principal, walletId: string) {
    await this.wallet(principal, walletId, false)
    const selected = await this.service.db.select().from(schedules).where(and(eq(schedules.ownerId, principal.ownerId), eq(schedules.walletId, walletId))).orderBy(desc(schedules.createdAt)).limit(100)
    const history = await this.service.db.select().from(plans).where(and(eq(plans.ownerId, principal.ownerId), eq(plans.walletId, walletId))).orderBy(desc(plans.createdAt)).limit(100)
    const operationIds = history.flatMap(plan => [plan.approvalId, plan.swapId]).filter((id): id is string => !!id)
    const receipts = operationIds.length ? await this.service.db.select({ id: operationRows.id, status: operationRows.status, transactionHash: operationRows.transactionHash, receipt: operationRows.receipt, usdSettledMicros: operationRows.usdSettledMicros }).from(operationRows).where(inArray(operationRows.id, operationIds)) : []
    return selected.map(schedule => ({ ...schedule, runs: history.filter(plan => plan.scheduleId === schedule.id).slice(0, 20).map(plan => ({ id: plan.id, createdAt: plan.createdAt, status: plan.status, error: plan.error, quote: plan.quote, operations: receipts.filter(receipt => receipt.id === plan.approvalId || receipt.id === plan.swapId) })) }))
  }
  async disable(tx: Tx, agentId: string) {
    await tx.update(schedules).set({ status: 'paused', version: sql`${schedules.version} + 1` }).where(and(eq(schedules.agentId, agentId), eq(schedules.status, 'active')))
    await tx.update(operationRows).set({ status: 'denied', error: 'Uniswap disabled; request new work after enabling it', authorizationSignature: null }).where(and(inArray(operationRows.status, ['pending_approval', 'queued']), sql`${operationRows.input}->'swap'->>'planId' IN (SELECT id::text FROM uniswap_plans WHERE "agentId" = ${agentId})`))
  }
  private async invalidateSchedule(tx: Tx, id: string) {
    await tx.update(operationRows).set({ status: 'denied', error: 'Schedule changed; unsubmitted execution cancelled', authorizationSignature: null }).where(and(inArray(operationRows.status, ['pending_approval', 'queued']), sql`${operationRows.input}->'swap'->>'planId' IN (SELECT id::text FROM uniswap_plans WHERE "scheduleId" = ${id})`))
  }
  async saveSchedule(principal: Principal, raw: unknown, id?: string, transaction?: Tx) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Schedule creation and editing require owner confirmation')
    const input = scheduleInput.parse(raw), { wallet, agent } = await this.wallet(principal, input.request.walletId)
    if (input.kind === 'dca' && input.request.type !== 'EXACT_INPUT') fail(400, 'invalid_schedule', 'DCA uses a fixed input amount')
    tokenUnits(input.request.amount, input.kind === 'gas_refill' ? 'ETH' : input.request.tokenIn); tokenUnits(input.request.maxFee, 'ETH')
    const minimumGasAtomic = input.kind === 'gas_refill' && input.minimumGas ? tokenUnits(input.minimumGas, 'ETH').toString() : null
    if (input.kind === 'gas_refill' && (!minimumGasAtomic || input.request.tokenIn !== 'USDC' || input.request.tokenOut !== 'ETH' || input.request.type !== 'EXACT_OUTPUT' || tokenUnits(input.request.amount, 'ETH') <= BigInt(minimumGasAtomic))) fail(400, 'invalid_refill', 'Gas refill requires USDC → ETH exact output with an ETH target above the minimum balance')
    const execute = async (tx: Tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      const values = { ownerId: principal.ownerId, agentId: agent.id, walletId: wallet.id, request: input.request, intervalMinutes: input.intervalMinutes, kind: input.kind, minimumGasAtomic, nextRunAt: new Date(Date.now() + input.intervalMinutes * 60000) }
      if (!id) {
        if (!input.id) fail(400, 'idempotency_required', 'Provide a stable schedule id when creating a schedule')
        const [created] = await tx.insert(schedules).values({ ...values, id: input.id }).onConflictDoNothing().returning()
        if (created) return created
        const [existing] = await tx.select().from(schedules).where(and(eq(schedules.id, input.id), eq(schedules.ownerId, principal.ownerId)))
        if (!existing || existing.walletId !== wallet.id || hash(JSON.stringify(swapRequest.parse(existing.request))) !== hash(JSON.stringify(values.request)) || existing.intervalMinutes !== values.intervalMinutes || existing.kind !== values.kind || existing.minimumGasAtomic !== values.minimumGasAtomic) fail(409, 'idempotency_conflict', 'Schedule ID already belongs to different settings')
        return existing
      }
      const [updated] = await tx.update(schedules).set({ ...values, version: sql`${schedules.version} + 1` }).where(and(eq(schedules.id, id), eq(schedules.ownerId, principal.ownerId), eq(schedules.walletId, wallet.id))).returning()
      if (!updated) fail(404, 'not_found', 'Schedule not found')
      await this.invalidateSchedule(tx, id)
      return updated
    }
    return transaction ? execute(transaction) : this.service.db.transaction(execute)
  }
  async scheduleStatus(principal: Principal, id: string, status: 'active' | 'paused' | 'cancelled', transaction?: Tx) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can change recurring execution')
    const execute = async (tx: Tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      const [current] = await tx.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.ownerId, principal.ownerId)))
      if (!current) fail(404, 'not_found', 'Schedule not found')
      if (current.status === status) return current
      if (current.status === 'cancelled') fail(409, 'schedule_cancelled', 'Cancelled schedules cannot be resumed; create a new schedule')
      const [row] = await tx.update(schedules).set({ status, version: sql`${schedules.version} + 1`, ...(status === 'active' ? { nextRunAt: new Date(Date.now() + 60000) } : {}) }).where(and(eq(schedules.id, id), eq(schedules.ownerId, principal.ownerId))).returning()
      if (!row) fail(404, 'not_found', 'Schedule not found')
      await this.invalidateSchedule(tx, id)
      return row
    }
    return transaction ? execute(transaction) : this.service.db.transaction(execute)
  }
  async target(principal: Principal, walletId: string) {
    await this.wallet(principal, walletId)
    const [saved] = await this.service.db.select().from(uniswapTargets).where(and(eq(uniswapTargets.walletId, walletId), eq(uniswapTargets.ownerId, principal.ownerId)))
    return { ethPercent: saved?.ethPercent ?? 20 }
  }
  async saveTarget(principal: Principal, walletId: string, ethPercent: number) {
    await this.wallet(principal, walletId)
    if (!Number.isInteger(ethPercent) || ethPercent < 0 || ethPercent > 100) fail(400, 'invalid_target', 'ETH target must be 0–100')
    await this.service.db.insert(uniswapTargets).values({ walletId, ownerId: principal.ownerId, ethPercent }).onConflictDoUpdate({ target: uniswapTargets.walletId, set: { ethPercent } })
    return { ethPercent }
  }
  async executeRebalance(principal: Principal, walletId: string, ethPercent: number, key: string) {
    await this.wallet(principal, walletId)
    const intentHash = hash(JSON.stringify({ rebalance: { walletId, ethPercent } }))
    const [existing] = await this.service.db.select().from(plans).where(and(eq(plans.principalKey, keyFor(principal)), eq(plans.idempotencyKey, key)))
    if (existing) {
      if (existing.requestHash !== intentHash) fail(409, 'idempotency_conflict', 'Key belongs to different rebalance terms')
      return this.get(principal, existing.id)
    }
    const preview = await this.rebalance(principal, walletId, ethPercent)
    await this.saveTarget(principal, walletId, ethPercent)
    return preview.request && preview.quote ? this.create(principal, { ...preview.request, minimumOutputAtomic: preview.quote.minimumOutputAtomic, maximumInputAtomic: preview.quote.maximumInputAtomic }, key, undefined, undefined, intentHash) : null
  }
  async rebalance(principal: Principal, walletId: string, ethPercent: number) {
    if (!Number.isInteger(ethPercent) || ethPercent < 0 || ethPercent > 100) fail(400, 'invalid_target', 'ETH percentage must be 0–100')
    const { wallet } = await this.wallet(principal, walletId)
    const client = evmClient(uniswap.chainId)
    if (await client.getChainId() !== 84532) throw Error('RPC network mismatch')
    const [eth, usdc, price] = await Promise.all([client.getBalance({ address: wallet.address as Address }), client.readContract({ address: uniswap.USDC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Address] }), quoteUsd({ chainId: uniswap.chainId, asset: 'native' })])
    const ethMicros = eth * BigInt(price.assetPrice) / 10n ** 30n, total = ethMicros + usdc
    const delta = ethMicros - total * BigInt(ethPercent) / 100n
    if (total === 0n || (delta < 0n ? -delta : delta) < 1000n) return { ethPercent, usdMicros: total.toString(), request: null, quote: null }
    const tokenIn = delta > 0n ? 'ETH' : 'USDC', tokenOut = delta > 0n ? 'USDC' : 'ETH'
    const atomic = delta > 0n ? delta * 10n ** 30n / BigInt(price.assetPrice) : -delta
    // Retain enough ETH for this transaction. Rebalance targets are approximate after fees.
    if (tokenIn === 'ETH' && eth - atomic < tokenUnits('0.0001', 'ETH')) fail(409, 'gas_reserve', 'Lower the sell amount or retain a larger ETH allocation for gas')
    const request = swapRequest.parse({ walletId, tokenIn, tokenOut, amount: formatUnits(atomic, tokenIn === 'ETH' ? 18 : 6) })
    return { ethPercent, usdMicros: total.toString(), request, quote: await this.quoteSource(request) }
  }
  async requestSetup(principal: Principal, raw: unknown) {
    const value = z.object({ action: z.enum(['create', 'edit', 'active', 'paused', 'cancelled']), scheduleId: z.string().uuid().optional(), input: scheduleInput.optional() }).strict().parse(raw)
    if (value.action === 'create' && value.scheduleId) fail(400, 'invalid_setup', 'New schedules cannot reference an existing schedule')
    if (!['create', 'edit'].includes(value.action) && value.input) fail(400, 'invalid_setup', 'Status changes must use the stored schedule settings')
    let walletId = value.input?.request.walletId, scheduleVersion: number | undefined
    if (value.action !== 'create') {
      if (!value.scheduleId) fail(400, 'schedule_required', 'Select a schedule')
      const [schedule] = await this.service.db.select().from(schedules).where(and(eq(schedules.id, value.scheduleId), eq(schedules.ownerId, principal.ownerId)))
      if (!schedule) fail(404, 'not_found', 'Schedule not found')
      if (walletId && walletId !== schedule.walletId) fail(400, 'wallet_mismatch', 'Schedule wallet cannot change')
      walletId = schedule.walletId; scheduleVersion = schedule.version
    }
    if (!walletId || (['create', 'edit'].includes(value.action) && !value.input)) fail(400, 'input_required', 'Provide schedule settings')
    await this.wallet(principal, walletId, !['paused', 'cancelled'].includes(value.action))
    const [request] = await this.service.db.insert(setupRequests).values({ ownerId: principal.ownerId, walletId, grantId: principal.kind === 'agent' ? principal.grantId : null, action: value.action, scheduleId: value.scheduleId, scheduleVersion, input: value.input, expiresAt: new Date(Date.now() + 600000) }).returning()
    return { id: request!.id, approvalUrl: `${this.service.dashboardUrl}/plugins/uniswap/setup?request=${request!.id}` }
  }
  async setup(principal: Principal, id: string) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Owner confirmation required')
    const [request] = await this.service.db.select().from(setupRequests).where(and(eq(setupRequests.id, id), eq(setupRequests.ownerId, principal.ownerId)))
    if (!request) fail(404, 'not_found', 'Request not found')
    const [currentSchedule] = request.scheduleId ? await this.service.db.select().from(schedules).where(and(eq(schedules.id, request.scheduleId), eq(schedules.ownerId, principal.ownerId))) : []
    return { ...request, currentSchedule: currentSchedule ?? null }
  }
  async completeSetup(principal: Principal, id: string, approve: boolean) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Owner confirmation required')
    return this.service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      const [request] = await tx.select().from(setupRequests).where(and(eq(setupRequests.id, id), eq(setupRequests.ownerId, principal.ownerId))).for('update')
      if (!request || request.completed || request.expiresAt.getTime() <= Date.now()) fail(409, 'request_expired', 'Request is expired or already completed')
      if (request.grantId) await this.wallet({ kind: 'agent', ownerId: principal.ownerId, grantId: request.grantId }, request.walletId, false)
      if (approve) {
        if (request.scheduleId) {
          const [current] = await tx.select().from(schedules).where(eq(schedules.id, request.scheduleId))
          if (!current || current.ownerId !== principal.ownerId || current.walletId !== request.walletId || current.version !== request.scheduleVersion) fail(409, 'schedule_changed', 'Schedule changed; request a fresh confirmation')
        }
        if (request.action === 'create' || request.action === 'edit') await this.saveSchedule(principal, { ...request.input, id: request.id }, request.action === 'edit' ? request.scheduleId! : undefined, tx)
        else await this.scheduleStatus(principal, request.scheduleId!, request.action, tx)
      }
      await tx.update(setupRequests).set({ completed: true }).where(eq(setupRequests.id, id))
      return { completed: true, approved: approve }
    })
  }
  async tick() {
    for (const plan of await this.service.db.select().from(plans).where(eq(plans.status, 'pending')).limit(50)) {
      try { await this.progress(plan) } catch { /* Next tick reconciles the same persisted operation IDs. */ }
    }
    for (const schedule of await this.service.db.select().from(schedules).where(and(eq(schedules.status, 'active'), lte(schedules.nextRunAt, new Date()))).limit(25)) {
      try {
        if (schedule.activePlanId) {
          const [active] = await this.service.db.select().from(plans).where(eq(plans.id, schedule.activePlanId))
          if (active?.status === 'pending') continue
        }
        const principal: Principal = { kind: 'owner', ownerId: schedule.ownerId }
        const { wallet, agent } = await this.wallet(principal, schedule.walletId)
        if (agent.mode === 'paused') continue
        let runRequest = schedule.request
        if (schedule.kind === 'gas_refill') {
          const balance = await evmClient(uniswap.chainId).getBalance({ address: wallet.address as Address })
          if (balance >= BigInt(schedule.minimumGasAtomic!)) { await this.service.db.update(schedules).set({ nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60000) }).where(and(eq(schedules.id, schedule.id), eq(schedules.version, schedule.version))); continue }
          if (balance < tokenUnits(schedule.request.maxFee, 'ETH')) throw Error('Not enough ETH to fund a refill swap; fund gas manually')
          runRequest = { ...schedule.request, amount: formatUnits(tokenUnits(schedule.request.amount, 'ETH') - balance + 2n * tokenUnits(schedule.request.maxFee, 'ETH'), 18) }
        }
        const plan = await this.create(principal, runRequest, `dca:${schedule.id}:${schedule.version}:${schedule.nextRunAt.getTime()}`, { id: schedule.id, version: schedule.version })
        await this.service.db.update(schedules).set({ activePlanId: plan.id, lastError: null, nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60000) }).where(and(eq(schedules.id, schedule.id), eq(schedules.version, schedule.version)))
      } catch (error) {
        await this.service.db.update(schedules).set({ lastError: error instanceof Error && 'code' in error ? error.message : 'Scheduled run could not start; check balances, gas and route availability', nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60000) }).where(and(eq(schedules.id, schedule.id), eq(schedules.version, schedule.version)))
      }
    }
  }
}

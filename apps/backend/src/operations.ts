import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { operationInput, walletPolicy, grantInput, type GrantInput, type Operation, type OperationInput } from '@agentis-hq/core/operations'
import type { Database } from './db'
import { grants, operations, wallets, onboarding, agents, type OperationRow, type WalletRow } from './db/schema'
import { fail } from './errors'
import type { PluginConfig } from './plugins'
import { buildTransfer } from './modules/transfers'
import { quoteUsd, usdCost } from './modules/usd-budget'
import type { Executor } from './providers/types'

export type Principal = { kind: 'owner'; ownerId: string } | { kind: 'agent'; ownerId: string; grantId: string }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const reserved = ['pending_approval', 'queued', 'submitting', 'submitted', 'unknown'] as const
const uncertain = ['submitting', 'submitted', 'unknown'] as const
export const cost = (input: OperationInput) => (input.asset === 'native' ? BigInt(input.amountAtomic) : 0n) + BigInt(input.maxFeeAtomic)
const lifetimeMs = 10 * 60_000
const assetKey = (asset: string) => asset.startsWith('erc20:') ? asset.toLowerCase() : asset

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const grantAllowsWallet = (grant: typeof grants.$inferSelect, wallet: WalletRow) =>
  grant.ownerId === wallet.ownerId && !grant.revokedAt && (grant.expiresAt === null || grant.expiresAt.getTime() > Date.now()) &&
  (grant.walletId !== null ? grant.walletId === wallet.id : grant.agentId !== null && grant.agentId === wallet.agentId) &&
  (grant.chainIds === null || grant.chainIds.includes(wallet.chainId))

export class OperationService {
  constructor(readonly db: Database, readonly executor: Executor | null, readonly config: PluginConfig, readonly dashboardUrl: string, readonly priceQuote: typeof quoteUsd = quoteUsd) {}

  view(row: OperationRow): Operation {
    return {
      ...row.input, id: row.id, status: row.status, operationHash: row.operationHash,
      policyVersion: row.policyVersion, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      approvalUrl: row.status === 'pending_approval' ? `${this.dashboardUrl}/operations/${row.id}` : null,
      transactionHash: row.transactionHash, receipt: row.receipt, error: row.error,
      usdReservedMicros: row.usdReservedMicros, usdSettledMicros: row.usdSettledMicros,
    }
  }

  private async lockWallet(tx: Transaction, principal: Principal, id: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
    const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.id, id), eq(wallets.ownerId, principal.ownerId))).for('update')
    if (!wallet) fail(404, 'not_found', 'Wallet not found')
    if (principal.kind === 'agent') await this.checkGrant(tx, principal.grantId, wallet)
    return wallet
  }

  private async checkGrant(tx: Transaction, grantId: string, wallet: WalletRow) {
    const [grant] = await tx.select().from(grants).where(eq(grants.id, grantId))
    if (!grant || !grantAllowsWallet(grant, wallet)) {
      fail(403, 'grant_inactive', 'Grant is revoked, expired or not valid for this wallet')
    }
    return grant
  }

  private async expire(tx: Transaction, walletId: string) {
    await tx.update(operations).set({ status: 'expired', error: 'Authorization window expired' }).where(and(
      eq(operations.walletId, walletId), inArray(operations.status, ['pending_approval', 'queued']), lt(operations.expiresAt, new Date()),
    ))
  }

  private policyReason(wallet: WalletRow, input: OperationInput) {
    if (!wallet.enabled) return 'Network is disabled'
    if (wallet.policy.mode === 'paused') return 'Wallet is paused'
    if (wallet.policy.budgetMode !== 'usd' && input.asset !== 'native') {
      const limit = Object.entries(wallet.policy.tokenLimits ?? {}).find(([asset]) => assetKey(asset) === assetKey(input.asset))?.[1]
      if (!limit || BigInt(input.amountAtomic) > BigInt(limit.perOperation)) return 'Token transfer exceeds its asset-specific limit'
    }
    if (wallet.chainId !== input.chainId) return 'Wrong chain for wallet'
    if (wallet.policy.budgetMode !== 'usd' && cost(input) > BigInt(wallet.policy.maxPerOperationAtomic)) return 'Per-operation limit exceeded (including fee cap)'
    if (wallet.policy.allowedRecipients.length && !wallet.policy.allowedRecipients.some(to => input.chainId.startsWith('solana:') ? to === input.to : to.toLowerCase() === input.to.toLowerCase())) return 'Recipient is not allowed'
    return null
  }

  private async usdBudgetReason(tx: Transaction, wallet: WalletRow, amount: bigint, excludeId?: string) {
    const [agent] = wallet.agentId ? await tx.select().from(agents).where(and(eq(agents.id, wallet.agentId), eq(agents.ownerId, wallet.ownerId))) : []
    const [budget] = await tx.select().from(onboarding).where(eq(onboarding.ownerId, wallet.ownerId))
    const history = agent
      ? (await tx.select({ operation: operations }).from(operations).innerJoin(wallets, eq(wallets.id, operations.walletId)).where(and(eq(operations.ownerId, wallet.ownerId), eq(wallets.agentId, agent.id)))).map(row => row.operation)
      : await tx.select().from(operations).where(eq(operations.ownerId, wallet.ownerId))
    let total = 0n, hourly = 0n, daily = 0n
    for (const row of history) {
      if (row.id === excludeId) continue
      const holding = (reserved as readonly string[]).includes(row.status)
      const charged = BigInt(holding ? row.usdReservedMicros ?? '0' : row.usdSettledMicros ?? '0')
      const age = Date.now() - (row.settledAt ?? row.createdAt).getTime()
      total += charged
      if (holding || age < 3_600_000) hourly += charged
      if (holding || age < 86_400_000) daily += charged
    }
    const limits = agent?.limits ?? { perTransaction: null, hourly: null, daily: null, total: budget?.totalBudgetUsdMicros ?? null }
    for (const [key, used] of [['perTransaction', 0n], ['hourly', hourly], ['daily', daily], ['total', total]] as const) {
      const limit = limits[key]
      if (limit !== null && used + amount > BigInt(limit)) return `${{ perTransaction: 'Per-payment', hourly: 'Hourly', daily: 'Daily', total: 'Total' }[key]} USD budget exceeded`
    }
    return null
  }

  async create(principal: Principal, raw: unknown, idempotencyKey: string): Promise<Operation> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) fail(400, 'idempotency_required', 'Provide an Idempotency-Key (1–128 safe characters)')
    const input = buildTransfer(operationInput.parse(raw))
    const principalKey = principal.kind === 'owner' ? `owner:${principal.ownerId}` : `grant:${principal.grantId}`
    const requestHash = hash(JSON.stringify(input))
    return this.db.transaction(async tx => {
      // Serializes idempotency keys even if two requests use different wallet IDs.
      // Lock order: principal, then wallet, everywhere this extra lock is needed.
      const { sql } = await import('drizzle-orm')
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${principalKey}, 0))`)
      const wallet = await this.lockWallet(tx, principal, input.walletId)
      const [existing] = await tx.select().from(operations).where(and(eq(operations.principalKey, principalKey), eq(operations.idempotencyKey, idempotencyKey)))
      if (existing) {
        if (existing.requestHash !== requestHash) fail(409, 'idempotency_conflict', 'Idempotency key already used for a different operation')
        return this.view(existing)
      }
      if (!this.executor || wallet.provider !== this.executor.id) fail(503, 'executor_unavailable', 'This provider is not enabled for execution yet')
      if (wallet.provider === 'privy' && !wallet.serverAuthorized) fail(409, 'wallet_setup_required', 'Open this agent’s rules and save once to enable hosted execution')
      this.executor.validate(wallet, input)
      await this.expire(tx, wallet.id)
      let reason = this.policyReason(wallet, input)
      // ponytail: O(n) wallet history under lock; use SQL ledger aggregates when volume warrants it.
      const rows = await tx.select().from(operations).where(eq(operations.walletId, wallet.id))
      let daily = 0n, lifetime = 0n, tokenDaily = 0n, tokenLifetime = 0n
      for (const row of rows) {
        const holding = (reserved as readonly string[]).includes(row.status)
        // Conservatively charge full approved cap for unsettled/recent reservations;
        // settled reverted transactions charge gas only.
        const charged = holding ? cost(row.input) : row.receipt ? BigInt(row.receipt.feeAtomic) + (row.receipt.success && row.input.asset === 'native' ? BigInt(row.input.amountAtomic) : 0n) : 0n
        if (input.asset !== 'native' && assetKey(row.input.asset) === assetKey(input.asset) && (holding || row.receipt?.success)) {
          tokenLifetime += BigInt(row.input.amountAtomic)
          if (holding || (row.settledAt ?? row.createdAt).getTime() >= Date.now() - 86_400_000) tokenDaily += BigInt(row.input.amountAtomic)
        }
        lifetime += charged
        if (holding || (row.settledAt ?? row.createdAt).getTime() >= Date.now() - 86_400_000) daily += charged
      }
      if (wallet.policy.budgetMode !== 'usd' && daily + cost(input) > BigInt(wallet.policy.maxDailyAtomic)) reason ??= 'Daily budget exceeded'
      if (wallet.policy.budgetMode !== 'usd' && lifetime + cost(input) > BigInt(wallet.policy.maxLifetimeAtomic)) reason ??= 'Lifetime budget exceeded'
      if (wallet.policy.budgetMode !== 'usd' && input.asset !== 'native') {
        const limits = Object.entries(wallet.policy.tokenLimits ?? {}).find(([asset]) => assetKey(asset) === assetKey(input.asset))?.[1]
        if (!limits || tokenDaily + BigInt(input.amountAtomic) > BigInt(limits.daily) || tokenLifetime + BigInt(input.amountAtomic) > BigInt(limits.lifetime)) reason ??= 'Token budget exceeded'
      }
      const [agent] = wallet.agentId ? await tx.select().from(agents).where(and(eq(agents.id, wallet.agentId), eq(agents.ownerId, wallet.ownerId))) : []
      if (agent) reason ??= this.policyReason({ ...wallet, policy: { ...wallet.policy, mode: agent.mode, allowedRecipients: agent.allowedRecipients } }, input)
      const [budget] = await tx.select().from(onboarding).where(eq(onboarding.ownerId, wallet.ownerId))
      let usdQuote: Awaited<ReturnType<typeof quoteUsd>> | null = null
      let usdReservedMicros: string | null = null
      if (agent || (budget?.totalBudgetUsdMicros !== null && budget?.totalBudgetUsdMicros !== undefined)) {
        try { usdQuote = await this.priceQuote(input) } catch { fail(503, 'price_unavailable', 'A fresh USD price is unavailable. No payment was created.') }
        if (usdQuote.expiresAt <= Date.now()) fail(503, 'price_expired', 'USD quote expired')
        usdReservedMicros = usdCost(input, usdQuote).toString()
        reason ??= await this.usdBudgetReason(tx, wallet, BigInt(usdReservedMicros))
      } else if (wallet.policy.budgetMode === 'usd') fail(409, 'budget_required', 'Set a total USD budget before making payments')
      const operationHash = hash(JSON.stringify({ input, policyVersion: wallet.policyVersion, ...(usdReservedMicros !== null ? { usdReservedMicros } : {}) }))
      const [row] = await tx.insert(operations).values({
        ownerId: wallet.ownerId, walletId: wallet.id, grantId: principal.kind === 'agent' ? principal.grantId : null,
        principalKey, idempotencyKey, requestHash, input, operationHash, policyVersion: wallet.policyVersion,
        status: reason ? 'denied' : wallet.policy.mode === 'ask' || agent?.mode === 'ask' || this.executor.authorization ? 'pending_approval' : 'queued',
        usdQuote, usdReservedMicros,
        error: reason, expiresAt: new Date(Date.now() + (input.chainId.startsWith('solana:') ? 60_000 : lifetimeMs)),
      }).returning()
      return this.view(row!)
    })
  }

  async get(principal: Principal, id: string) {
    const [row] = await this.db.select().from(operations).where(and(eq(operations.id, id), eq(operations.ownerId, principal.ownerId)))
    if (!row || (principal.kind === 'agent' && row.grantId !== principal.grantId)) fail(404, 'not_found', 'Operation not found')
    return this.view(row)
  }

  async list(principal: Principal) {
    const filter = principal.kind === 'owner' ? eq(operations.ownerId, principal.ownerId) : and(eq(operations.ownerId, principal.ownerId), eq(operations.grantId, principal.grantId))
    return (await this.db.select().from(operations).where(filter).orderBy(operations.createdAt).limit(100)).map(row => this.view(row))
  }

  async authorization(principal: Principal, id: string) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can authorize signing')
    if (!this.executor?.authorization) fail(400, 'authorization_unneeded', 'This provider does not require a Privy signature')
    const visible = await this.get(principal, id)
    return this.db.transaction(async tx => {
      const wallet = await this.lockWallet(tx, principal, visible.walletId)
      await this.expire(tx, wallet.id)
      const rows = await tx.select().from(operations).where(eq(operations.walletId, wallet.id))
      const row = rows.find(row => row.id === id)
      if (!row || row.status !== 'pending_approval' || row.policyVersion !== wallet.policyVersion || this.policyReason(wallet, row.input)) fail(409, 'not_pending', 'Operation cannot be authorized')
      if (rows.some(other => other.id !== id && (reserved as readonly string[]).includes(other.status) && (other.authorizationRequest || (uncertain as readonly string[]).includes(other.status)))) fail(409, 'wallet_busy', 'Resolve the earlier authorized operation first')
      if (row.authorizationRequest) return row.authorizationRequest
      const request = await this.executor!.authorization!(wallet, row.input, row.id, row.expiresAt)
      if (row.expiresAt.getTime() <= Date.now()) fail(409, 'approval_expired', 'Approval expired while preparing')
      await tx.update(operations).set({ authorizationRequest: request }).where(eq(operations.id, id))
      return request
    })
  }

  async decide(principal: Principal, id: string, operationHash: string, approve: boolean, signature?: string) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the wallet owner can approve or reject')
    const visible = await this.get(principal, id)
    return this.db.transaction(async tx => {
      const wallet = await this.lockWallet(tx, principal, visible.walletId)
      const [row] = await tx.select().from(operations).where(eq(operations.id, id))
      if (!row || row.status !== 'pending_approval') fail(409, 'not_pending', 'Operation is no longer pending approval')
      if (row.operationHash !== operationHash) fail(409, 'approval_mismatch', 'Approval does not match the operation')
      if (row.expiresAt.getTime() <= Date.now()) fail(409, 'approval_expired', 'Approval has expired')
      if (approve) {
        if (wallet.provider === 'privy' && !wallet.serverAuthorized) fail(409, 'wallet_setup_required', 'Save this agent’s rules to enable hosted execution first')
        if (row.policyVersion !== wallet.policyVersion || this.policyReason(wallet, row.input)) fail(409, 'policy_changed', 'Policy changed; create a new operation')
        if (row.grantId) await this.checkGrant(tx, row.grantId, wallet)
        if (this.executor?.authorization && (!row.authorizationRequest || !signature)) fail(400, 'signature_required', 'Sign the concrete Privy request to authorize execution')
      }
      const [updated] = await tx.update(operations).set({ status: approve ? 'queued' : 'rejected', approvedAt: approve ? new Date() : null, authorizationSignature: approve ? signature ?? null : null }).where(eq(operations.id, id)).returning()
      return this.view(updated!)
    })
  }

  async setPolicy(principal: Principal, walletId: string, raw: unknown) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can update policy')
    const policy = walletPolicy.parse(raw)
    return this.db.transaction(async tx => {
      const wallet = await this.lockWallet(tx, principal, walletId)
      if (wallet.provider === 'privy' && policy.mode === 'automatic' && !wallet.serverAuthorized) fail(409, 'wallet_setup_required', 'Save this agent’s rules to enable hosted execution first')
      const [updated] = await tx.update(wallets).set({ policy, policyVersion: wallet.policyVersion + 1 }).where(eq(wallets.id, walletId)).returning()
      // Invalidate unexecuted authorizations and release reservations atomically.
      await tx.update(operations).set({ status: 'denied', error: 'Policy changed; create a new operation' }).where(and(eq(operations.walletId, walletId), inArray(operations.status, ['pending_approval', 'queued'])))
      return updated!
    })
  }

  async createGrant(principal: Principal, raw: GrantInput) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can delegate access')
    const input = grantInput.parse(raw)
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && expiresAt.getTime() <= Date.now()) fail(400, 'invalid_expiry', 'Expiry must be in the future')
    const token = `agt_exec_${randomBytes(32).toString('hex')}`
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      if (input.walletId) await this.lockWallet(tx, principal, input.walletId)
      else {
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.agentId!), eq(agents.ownerId, principal.ownerId)))
        if (!agent) fail(404, 'not_found', 'Agent not found')
        if (input.chainIds) {
          const enabled = await tx.select({ chainId: wallets.chainId }).from(wallets).where(and(eq(wallets.ownerId, principal.ownerId), eq(wallets.agentId, agent.id), eq(wallets.enabled, true)))
          if (input.chainIds.some(chainId => !enabled.some(wallet => wallet.chainId === chainId))) fail(400, 'invalid_network_scope', 'Choose enabled networks belonging to this agent')
        }
      }
      const [grant] = await tx.insert(grants).values({ ...input, ownerId: principal.ownerId, tokenHash: hash(token), expiresAt }).returning()
      return { id: grant!.id, walletId: grant!.walletId, agentId: grant!.agentId, chainIds: grant!.chainIds, agentName: input.agentName, expiresAt: expiresAt?.toISOString() ?? null, token }
    })
  }

  async revoke(principal: Principal, id: string) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can revoke grants')
    const [grant] = await this.db.select().from(grants).where(and(eq(grants.id, id), eq(grants.ownerId, principal.ownerId)))
    if (!grant) fail(404, 'not_found', 'Grant not found')
    await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`}, 0))`)
      await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, id))
      await tx.update(operations).set({ status: 'denied', error: 'Grant revoked' }).where(and(eq(operations.grantId, id), inArray(operations.status, ['pending_approval', 'queued'])))
    })
  }

  // One transaction prepares at most one action per wallet. Multiple workers use
  // row locks; an unresolved submission blocks that wallet's nonce lane.
  async tick() {
    if (!this.executor) return
    const executor = this.executor
    const walletRows = await this.db.select().from(wallets).where(eq(wallets.provider, executor.id))
    for (const candidate of walletRows) {
      const prepared = await this.db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${candidate.ownerId}`}, 0))`)
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, candidate.id)).for('update', { skipLocked: true })
        if (!wallet) return null
        await this.expire(tx, wallet.id)
        const rows = await tx.select().from(operations).where(eq(operations.walletId, wallet.id)).orderBy(operations.createdAt)
        const pending = rows.find(row => (uncertain as readonly string[]).includes(row.status))
        if (pending) {
          if (!pending.transactionHash) return null
          const receipt = await executor.receipt(pending.transactionHash, pending.input)
          if (receipt && ((pending.input.chainId.startsWith('solana:') ? receipt.transactionHash !== pending.transactionHash : receipt.transactionHash.toLowerCase() !== pending.transactionHash.toLowerCase()) || receipt.chainId !== pending.input.chainId || BigInt(receipt.feeAtomic) < 0n)) throw new Error('Provider receipt mismatch')
          await tx.update(operations).set(receipt
            ? { status: receipt.success ? 'confirmed' : 'failed', receipt, usdSettledMicros: pending.usdQuote ? usdCost(pending.input, pending.usdQuote, receipt.feeAtomic, receipt.success).toString() : null, settledAt: new Date(), signedTransaction: null, authorizationSignature: null, error: receipt.success ? null : 'Transaction reverted' }
            : { status: 'unknown', error: 'Submission unresolved; reservation retained, no automatic resend' }
          ).where(eq(operations.id, pending.id))
          return null
        }
        const row = rows.find(row => row.status === 'queued')
        if (!row) return null
        let reason = row.policyVersion !== wallet.policyVersion ? 'Policy changed' : this.policyReason(wallet, row.input)
        if (wallet.provider === 'privy' && !wallet.serverAuthorized) reason = 'Wallet setup required; save this agent’s rules first'
        if (row.grantId) {
          const [grant] = await tx.select().from(grants).where(eq(grants.id, row.grantId))
          if (!grant || !grantAllowsWallet(grant, wallet)) reason = 'Grant inactive or outside wallet scope'
        }
        const [agent] = wallet.agentId ? await tx.select().from(agents).where(eq(agents.id, wallet.agentId)) : []
        if (agent) reason ??= this.policyReason({ ...wallet, policy: { ...wallet.policy, mode: agent.mode, allowedRecipients: agent.allowedRecipients } }, row.input)
        if ((wallet.policy.mode === 'ask' || agent?.mode === 'ask') && !row.approvedAt) reason = 'Approval required'
        if (reason) {
          await tx.update(operations).set({ status: 'denied', error: reason }).where(eq(operations.id, row.id))
          return null
        }
        try {
          const executionQuote = row.usdQuote ? await this.priceQuote(row.input) : null
          if (executionQuote && (executionQuote.expiresAt <= Date.now() || usdCost(row.input, executionQuote) > BigInt(row.usdReservedMicros!))) {
            await tx.update(operations).set({ status: 'denied', authorizationSignature: null, error: 'USD price changed beyond the reviewed amount. Request a new payment for approval.' }).where(eq(operations.id, row.id))
            return null
          }
          const budgetReason = executionQuote ? await this.usdBudgetReason(tx, wallet, usdCost(row.input, executionQuote), row.id) : null
          if (budgetReason) {
            await tx.update(operations).set({ status: 'denied', error: budgetReason, authorizationSignature: null }).where(eq(operations.id, row.id))
            return null
          }
          const signed = await executor.prepare(wallet, row.input, row.authorizationRequest && row.authorizationSignature ? { request: row.authorizationRequest, signature: row.authorizationSignature } : undefined, { id: row.id, expiresAt: row.expiresAt })
          // Network preparation may outlast authorization: check again before persisting.
          if (row.expiresAt.getTime() <= Date.now() || (executionQuote && executionQuote.expiresAt <= Date.now())) throw new Error('Authorization or USD quote expired while preparing')
          if (row.grantId) await this.checkGrant(tx, row.grantId, wallet)
          const [updated] = await tx.update(operations).set({ ...signed, usdQuote: executionQuote, status: 'submitting' }).where(eq(operations.id, row.id)).returning()
          return updated!
        } catch {
          await tx.update(operations).set({ status: 'failed', error: 'Preparation failed before submission' }).where(eq(operations.id, row.id))
          return null
        }
      })
      if (prepared) {
        try {
          await executor.broadcast(prepared.signedTransaction!)
          await this.db.update(operations).set({ status: 'submitted', error: null }).where(and(eq(operations.id, prepared.id), inArray(operations.status, ['submitting', 'unknown'])))
        } catch {
          await this.db.update(operations).set({ status: 'unknown', error: 'Submission outcome unknown; reconcile before retrying' }).where(and(eq(operations.id, prepared.id), inArray(operations.status, ['submitting', 'unknown'])))
        }
      }
    }
  }
}

import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { CardCheckout, CardCheckoutReplay, CardPurchaseTurn } from '@agentis-hq/sdk'
import type { BuyTurn } from '@agent-cards/sdk'
import { agents, cardCheckouts, cardCheckoutPermissions, cardVaults, cardPurchaseTurns, grants } from '../../db/schema'
import type { OperationService, Principal, Transaction } from '../../operations'
import { fail } from '../../errors'
import { AgentcardProvider, cardAuthorization } from './provider'
import { checkoutTerms, purchaseAsk, purchaseConfirm, purchaseCart, type CheckoutInput, type PurchaseInput } from './checkout-input'
import { cardBudgetReason } from '../../modules/cards/budget'

type Row = typeof cardCheckouts.$inferSelect
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const terminal = ['confirmed', 'failed', 'rejected', 'expired']
const replayRetentionMs = 20 * 60_000
const purgeable = () => and(eq(cardCheckouts.provider, 'agentcard'), inArray(cardCheckouts.status, ['confirmed', 'failed', 'rejected', 'expired']), lt(cardCheckouts.expiresAt, new Date(Date.now() - replayRetentionMs)), or(ne(cardCheckouts.encryptedRequest, ''), isNotNull(cardCheckouts.encryptedReplay), isNotNull(cardCheckouts.encryptedApprovalUrl)))
const overrunError = 'Processor charge exceeded the reviewed ceiling; actual spend recorded. Contact support.'
const policyHash = (agent: typeof agents.$inferSelect) => digest({ mode: agent.mode, limits: agent.limits, recipients: agent.allowedRecipients })
const approvalHash = (input: unknown, row: Pick<Row, 'usdReservedMicros' | 'policyHash' | 'vaultId' | 'vaultLinkedAt' | 'permissionRevision'>) => digest({ input, ceiling: row.usdReservedMicros, policy: row.policyHash, vault: row.vaultId, linkedAt: row.vaultLinkedAt.toISOString(), permission: row.permissionRevision })
export class AgentcardService {
  constructor(readonly service: OperationService, readonly provider = AgentcardProvider.fromEnv()) {}
  /** The connection is owner-wide; disabling one agent never disconnects other agents. */
  async disable(tx: Transaction, agentId: string) {
    const permissions = await tx.select({ grantId: cardCheckoutPermissions.grantId }).from(cardCheckoutPermissions).innerJoin(cardVaults, eq(cardVaults.id, cardCheckoutPermissions.vaultId)).where(and(eq(cardCheckoutPermissions.agentId, agentId), eq(cardVaults.provider, 'agentcard')))
    if (permissions.length) await tx.update(cardCheckoutPermissions).set({ enabled: false, revision: sql`${cardCheckoutPermissions.revision} + 1` }).where(inArray(cardCheckoutPermissions.grantId, permissions.map(row => row.grantId)))
    const scope = and(eq(cardCheckouts.agentId, agentId), eq(cardCheckouts.provider, 'agentcard'))
    await tx.update(cardCheckouts).set({ status: 'rejected', error: 'Agentcard plugin disabled' }).where(and(scope, inArray(cardCheckouts.status, ['pending_approval', 'queued'])))
    await tx.update(cardCheckouts).set({ cancelRequested: true, encryptedApprovalUrl: null, nextPollAt: new Date(0) }).where(and(scope, inArray(cardCheckouts.status, ['submitting', 'awaiting_provider', 'unknown'])))
  }
  get enabled() { return Boolean(this.provider && process.env.AGENTIS_CARD_CHECKOUT_ENABLED === 'true') }
  private api() { if (!this.provider) fail(503, 'cards_not_configured', 'Card checkout provider is not configured'); return this.provider }
  private async lock(tx: Transaction, ownerId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${ownerId}`}, 0))`) }
  private async expire(tx: Transaction, ownerId: string) {
    // No external authorization exists in these states. Uncertain/submitted rows never expire a hold here.
    await tx.update(cardCheckouts).set({ status: 'expired', encryptedRequest: '', error: 'Owner approval/execution window expired' }).where(and(eq(cardCheckouts.ownerId, ownerId), eq(cardCheckouts.provider, 'agentcard'), inArray(cardCheckouts.status, ['pending_approval', 'queued']), lt(cardCheckouts.expiresAt, new Date())))
    await tx.update(cardCheckouts).set({ encryptedRequest: '', encryptedReplay: null, encryptedApprovalUrl: null }).where(and(eq(cardCheckouts.ownerId, ownerId), purgeable()))
  }
  private async authority(tx: Transaction, principal: Principal, agentId: string) {
    let revision: number | null = null, permittedVault: string | null = null, grantDeadline = Infinity
    if (principal.kind === 'agent') {
      const [grant] = await tx.select().from(grants).where(and(eq(grants.id, principal.grantId), eq(grants.ownerId, principal.ownerId), eq(grants.agentId, agentId)))
      const [permission] = await tx.select().from(cardCheckoutPermissions).where(and(eq(cardCheckoutPermissions.grantId, principal.grantId), eq(cardCheckoutPermissions.ownerId, principal.ownerId), eq(cardCheckoutPermissions.agentId, agentId)))
      if (!grant || grant.revokedAt || (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) || !permission?.enabled) fail(403, 'card_scope_required', 'This key has no active, explicit card-checkout request permission')
      revision = permission.revision; permittedVault = permission.vaultId; grantDeadline = grant.expiresAt?.getTime() ?? Infinity
    }
    const [agent] = await tx.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.ownerId, principal.ownerId)))
    if (!agent) fail(404, 'not_found', 'Agent not found')
    if (!agent.plugins.includes('agentcard')) fail(403, 'plugin_disabled', 'Enable the Agentcard plugin for this agent first')
    if (agent.mode === 'paused') fail(409, 'agent_paused', 'Agent is paused')
    if (agent.allowedRecipients.length) fail(409, 'unsupported_card_policy', 'An address-only recipient policy cannot authorize merchant card payments')
    const [overrun] = await tx.select({ id: cardCheckouts.id }).from(cardCheckouts).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.agentId, agentId), eq(cardCheckouts.error, overrunError))).limit(1)
    if (overrun) fail(409, 'card_review_required', 'A prior card charge exceeded its ceiling; card execution requires operator review')
    const [vault] = await tx.select().from(cardVaults).where(and(eq(cardVaults.ownerId, principal.ownerId), eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, this.api().fingerprint)))
    if (!vault || vault.disconnectedAt) fail(409, 'vault_required', 'The owner must connect their Vault first')
    if (principal.kind === 'agent' && permittedVault !== vault.id) fail(403, 'card_scope_required', 'Card permission is bound to a different Vault connection')
    return { agent, vault, revision, grantDeadline }
  }
  private requester(row: Row): Principal { return row.grantId ? { kind: 'agent', ownerId: row.ownerId, grantId: row.grantId } : { kind: 'owner', ownerId: row.ownerId } }
  private async executionReason(tx: Transaction, row: Row) {
    const state = await this.authority(tx, this.requester(row), row.agentId)
    if (state.vault.id !== row.vaultId || state.vault.linkedAt.getTime() !== row.vaultLinkedAt.getTime() || state.revision !== row.permissionRevision || policyHash(state.agent) !== row.policyHash) fail(409, 'card_policy_changed', 'Card connection, permission or agent policy changed; this approval cannot execute')
    const reason = await cardBudgetReason(tx, row.ownerId, row.agentId, row.testMode, state.agent.limits, BigInt(row.usdReservedMicros), row.id)
    if (reason) fail(409, 'budget_exceeded', reason)
    return state
  }
  private view(row: Row, principal: Principal): CardCheckout {
    const approvalUrl = new URL(`/dashboard/agents/${row.agentId}`, this.service.dashboardUrl); approvalUrl.hash = 'card-checkouts'
    return { id: row.id, agentId: row.agentId, provider: row.provider, rail: row.rail, cart: row.details.cart, deliveryAddress: row.details.deliveryAddress, orderId: row.details.orderId, processorIntentId: row.intentId, merchant: row.merchant, checkoutOrigin: row.checkoutOrigin, amountMinor: row.amountMinor, currency: 'usd', status: row.status,
      operationHash: row.operationHash, usdReservedMicros: row.usdReservedMicros, usdSettledMicros: row.usdSettledMicros, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), approvalUrl: approvalUrl.href, error: row.error, merchantOrderConfirmed: row.details.merchantOrderConfirmed ?? false,
      ...(principal.kind === 'owner' && row.encryptedApprovalUrl && this.provider && this.enabled && !row.cancelRequested && !terminal.includes(row.status) ? { providerApprovalUrl: this.provider.open(row.encryptedApprovalUrl, `approval:${row.ownerId}:${row.id}`) } : {}),
    }
  }
  private async visible(principal: Principal, id: string) {
    const [row] = await this.service.db.select().from(cardCheckouts).where(and(eq(cardCheckouts.id, id), eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.provider, 'agentcard'), principal.kind === 'agent' ? eq(cardCheckouts.grantId, principal.grantId) : undefined))
    if (!row) fail(404, 'not_found', 'Card checkout not found')
    return row
  }
  async create(principal: Principal, raw: unknown, key: string) {
    const { input, intentId } = checkoutTerms(raw)
    return this.reserve(principal, input, key, intentId)
  }
  private async reserve(principal: Principal, input: CheckoutInput, key: string, intentId: string) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail(400, 'idempotency_required', 'An idempotency key is required')
    const requestHash = digest(input), principalKey = principal.kind === 'owner' ? `owner:${principal.ownerId}` : `grant:${principal.grantId}`
    return this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId); await this.expire(tx, principal.ownerId)
      const [existing] = await tx.select().from(cardCheckouts).where(and(eq(cardCheckouts.principalKey, principalKey), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.idempotencyKey, key)))
      if (existing) { if (existing.requestHash !== requestHash) fail(409, 'idempotency_conflict', 'This key is bound to different checkout terms'); return { ...this.view(existing, principal), newlyCreated: false } }
      if (!this.enabled) fail(503, 'checkout_disabled', 'Card checkout preview is not enabled on this server')
      const { agent, vault, revision } = await this.authority(tx, principal, input.agentId)
      const [prior] = await tx.select({ id: cardCheckouts.id }).from(cardCheckouts).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.provider, 'agentcard'), eq(cardCheckouts.clientFingerprint, vault.clientFingerprint), eq(cardCheckouts.intentId, intentId), inArray(cardCheckouts.status, ['pending_approval', 'queued', 'submitting', 'awaiting_provider', 'unknown', 'confirmed'])))
      if (prior) fail(409, 'checkout_already_exists', 'This processor intent already has an active or settled checkout. Reconcile the original request; do not use a new key.')
      // Agentcard documents a one-minor-unit matching tolerance. Reserve and display that full ceiling.
      const reserved = (BigInt('purchase' in input ? input.purchase.cart.approvedCeilingCents ?? input.amountMinor : input.amountMinor + 1) * 10_000n).toString()
      const reason = await cardBudgetReason(tx, principal.ownerId, agent.id, vault.testMode, agent.limits, BigInt(reserved))
      if (reason) fail(409, 'budget_exceeded', reason)
      const id = crypto.randomUUID()
      const bound = { usdReservedMicros: reserved, policyHash: policyHash(agent), vaultId: vault.id, vaultLinkedAt: vault.linkedAt, permissionRevision: revision }
      const operationHash = approvalHash(input, bound)
      const [row] = await tx.insert(cardCheckouts).values({ id, ownerId: principal.ownerId, agentId: agent.id, grantId: principal.kind === 'agent' ? principal.grantId : null, vaultId: vault.id, clientFingerprint: vault.clientFingerprint, testMode: vault.testMode,
        principalKey, idempotencyKey: key, requestHash, operationHash, policyHash: policyHash(agent), permissionRevision: revision, vaultLinkedAt: vault.linkedAt,
        intentId, merchant: input.merchant, checkoutOrigin: input.checkoutOrigin, amountMinor: input.amountMinor, encryptedRequest: this.api().seal(JSON.stringify(input), `request:${principal.ownerId}:${id}`),
        rail: 'purchase' in input ? 'purchase' : 'browser', details: 'purchase' in input ? { cart: input.purchase.cart, deliveryAddress: input.purchase.deliveryAddress } : {},
        status: agent.mode === 'automatic' ? 'queued' : 'pending_approval', usdReservedMicros: reserved, expiresAt: new Date(Date.now() + 600_000),
      }).returning()
      return { ...this.view(row!, principal), newlyCreated: true }
    })
  }
  async list(principal: Principal, agentId: string) {
    await this.service.db.transaction(async tx => { await this.lock(tx, principal.ownerId); await this.expire(tx, principal.ownerId) })
    const rows = await this.service.db.select().from(cardCheckouts).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.agentId, agentId), eq(cardCheckouts.provider, 'agentcard'), principal.kind === 'agent' ? eq(cardCheckouts.grantId, principal.grantId) : undefined)).orderBy(desc(cardCheckouts.createdAt)).limit(50)
    return rows.map(row => this.view(row, principal))
  }
  async decide(principal: Principal, id: string, operationHash: string, approve: boolean) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Agents cannot approve their own card purchases')
    await this.visible(principal, id)
    return this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
      if (!row || row.status !== 'pending_approval' || row.operationHash !== operationHash || row.expiresAt.getTime() <= Date.now()) fail(409, 'approval_changed', 'Card approval is stale or no longer pending')
      if (approve) await this.executionReason(tx, row)
      const [updated] = await tx.update(cardCheckouts).set({ status: approve ? 'queued' : 'rejected' }).where(eq(cardCheckouts.id, id)).returning()
      return this.view(updated!, principal)
    })
  }
  async execute(principal: Principal, id: string) {
    if (!this.enabled) fail(503, 'checkout_disabled', 'Card checkout execution is disabled')
    await this.visible(principal, id)
    const claim = await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
      if (!row || row.status !== 'queued') return null
      if (row.expiresAt.getTime() <= Date.now()) fail(409, 'approval_expired', 'Card checkout approval expired')
      const state = await this.executionReason(tx, row)
      const input = JSON.parse(this.api().open(row.encryptedRequest, `request:${row.ownerId}:${row.id}`)) as CheckoutInput
      if (digest(input) !== row.requestHash || approvalHash(input, row) !== row.operationHash) fail(409, 'checkout_changed', 'Persisted checkout does not match approval')
      if ('purchase' in input) {
        const conversation = await this.api().buyConversation(state.vault.userId, input.purchase.conversationId)
        if (conversation.turn_in_progress || conversation.orders.length || !conversation.carts.some(cart => digest(purchaseCart.parse(cart)) === digest(input.purchase.cart))) fail(409, 'cart_changed', 'The cart changed or an order already exists. Inspect the original conversation; no confirmation sent.')
      }
      if (row.expiresAt.getTime() <= Date.now()) fail(409, 'approval_expired', 'Card checkout approval expired during verification')
      await tx.update(cardCheckouts).set({ status: 'submitting' }).where(eq(cardCheckouts.id, id))
      return { row, input, user: state.vault.userId }
    })
    if (!claim) return this.get(principal, id)
    if ('purchase' in claim.input) return this.executePurchase(principal, claim.row, claim.input, claim.user)
    const browserInput = claim.input
    // This durable state is never sent a second time, including after a lost create response.
    let dispatched = false
    try {
      const result = await this.service.db.transaction(async tx => {
        await this.lock(tx, principal.ownerId)
        const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
        if (!row || row.status !== 'submitting') return null
        if (row.cancelRequested) { await tx.update(cardCheckouts).set({ status: 'rejected' }).where(eq(cardCheckouts.id, id)); return null }
        try { await this.executionReason(tx, row) } catch {
          await tx.update(cardCheckouts).set({ status: 'failed', error: 'Authority changed before provider dispatch; nothing submitted' }).where(eq(cardCheckouts.id, id)); return
        }
        if (row.expiresAt.getTime() <= Date.now()) { await tx.update(cardCheckouts).set({ status: 'expired' }).where(eq(cardCheckouts.id, id)); return }
        const result = await this.api().createAuthorization({ ...browserInput.authorization, user: claim.user, merchant: row.merchant, checkout_origin: row.checkoutOrigin, amount: row.amountMinor, currency: 'usd' }, async () => {
          const live = await this.executionReason(tx, row)
          return Math.min(row.expiresAt.getTime(), live.grantDeadline)
        }, () => { dispatched = true })
        // Persist provider identity before interpreting the rest of the result. A DB failure retains the original uncertain claim.
        await tx.update(cardCheckouts).set({ providerId: result.id, status: 'awaiting_provider' }).where(eq(cardCheckouts.id, id))
        return result
      })
      // Commit the provider identity before interpreting settlement/replay evidence.
      if (result) await this.service.db.transaction(async tx => {
        await this.lock(tx, principal.ownerId)
        const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
        if (row) await this.apply(tx, row, result)
      })
    } catch {
      await this.service.db.update(cardCheckouts).set({ status: dispatched ? 'unknown' : 'failed', error: dispatched ? 'Provider submission is uncertain; reservation retained. Do not retry with a new key.' : 'Checkout stopped before provider dispatch; nothing submitted' }).where(and(eq(cardCheckouts.id, id), eq(cardCheckouts.status, 'submitting')))
    }
    return this.get(principal, id)
  }
  private async apply(tx: Transaction, row: Row, result: z.infer<typeof cardAuthorization>) {
    if (result.id !== row.providerId || (terminal.includes(row.status) && row.status !== 'confirmed')) return
    const patch: Partial<typeof cardCheckouts.$inferInsert> = { nextPollAt: new Date(Date.now() + 5000) }
    const bound = result.currency === 'usd' && Number.isSafeInteger(result.amount) && Math.abs(result.amount! - row.amountMinor) <= 1
    if (!bound && !terminal.includes(row.status)) { patch.cancelRequested = true; patch.encryptedApprovalUrl = null }
    if (result.approvalUrl && !row.cancelRequested && bound && !terminal.includes(row.status)) {
      const url = new URL(result.approvalUrl)
      if (url.origin === 'https://vault.agentcard.sh' && !url.username && !url.password && !url.hash) patch.encryptedApprovalUrl = this.api().seal(result.approvalUrl, `approval:${row.ownerId}:${row.id}`)
    }
    const settlement = result.settlement
    if (!terminal.includes(row.status)) {
    if (settlement?.status === 'settled' && settlement.settled_currency === 'usd' && Number.isSafeInteger(settlement.settled_amount) && settlement.settled_amount! > 0) {
      const charged = BigInt(settlement.settled_amount!) * 10_000n
      patch.status = 'confirmed'; patch.usdSettledMicros = charged.toString(); patch.settledAt = new Date(); patch.encryptedApprovalUrl = null; patch.budgetUnsafe = false
      patch.error = charged > BigInt(row.usdReservedMicros) ? overrunError : null
    } else if (settlement?.status === 'settled') {
      patch.status = 'unknown'; patch.budgetUnsafe = true; patch.settledAt = new Date(); patch.encryptedApprovalUrl = null
      patch.error = 'Provider reports settlement without a valid USD amount. New spending is blocked pending reconciliation.'
    } else if ((settlement?.status === 'not_settled' && settlement.final) || (['declined', 'expired'].includes(result.status) && result.replay_attempted === false && !settlement && !['authorized', 'captured'].includes(result.charged_kind ?? '') && !['dispatching', 'outcome_unknown', 'succeeded', 'action_required'].includes(result.autopilot_status ?? ''))) {
      patch.status = 'failed'; patch.usdSettledMicros = '0'; patch.encryptedApprovalUrl = null; patch.budgetUnsafe = false; patch.error = 'Provider reports no settled charge'
    } else if (result.status === 'awaiting_approval' && !row.cancelRequested) patch.status = 'awaiting_provider'
    else { patch.status = 'unknown'; patch.error = 'Payment outcome is not established; reservation retained. Merchant order confirmation is separate.' }
    }
    // Official SDK owns mode-specific substitution, continuation and replay validation.
    // An approved token/ciphertext is NOT settlement: its financial hold remains until evidence arrives.
    if (bound && !row.cancelRequested) patch.encryptedReplay = this.api().seal(JSON.stringify(result), `replay:${row.ownerId}:${row.id}`)
    await tx.update(cardCheckouts).set(patch).where(eq(cardCheckouts.id, row.id))
  }
  async get(principal: Principal, id: string) {
    const visible = await this.visible(principal, id)
    if (visible.rail === 'purchase') {
      await this.service.db.transaction(async tx => { await this.lock(tx, principal.ownerId); await this.expire(tx, principal.ownerId) })
      return this.getPurchase(principal, await this.visible(principal, id))
    }
    if (visible.providerId && !terminal.includes(visible.status) && visible.nextPollAt.getTime() <= Date.now()) {
      const claimed = await this.service.db.transaction(async tx => {
        await this.lock(tx, principal.ownerId)
        const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
        if (!row || terminal.includes(row.status) || row.nextPollAt.getTime() > Date.now()) return null
        let cancelRequested = row.cancelRequested || !this.enabled
        try { await this.executionReason(tx, row) } catch { cancelRequested = true }
        await tx.update(cardCheckouts).set({ nextPollAt: new Date(Date.now() + 15_000), cancelRequested, ...(cancelRequested ? { encryptedApprovalUrl: null } : {}) }).where(eq(cardCheckouts.id, id)); return { ...row, cancelRequested }
      })
      if (claimed) {
        try {
          if (claimed.cancelRequested) { try { await this.api().cancelAuthorization(claimed.providerId!) } catch { /* May already be submitting/charged. Read authoritative settlement below. */ } }
          const result = await this.api().authorization(claimed.providerId!)
          await this.service.db.transaction(async tx => {
            await this.lock(tx, principal.ownerId)
            const [current] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
            if (current) await this.apply(tx, current, result)
          })
        } catch { /* Read failures retain the hold and never cause provider creation or resend. */ }
      }
    }
    await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId); await this.expire(tx, principal.ownerId)
      if (!visible.providerId) await tx.update(cardCheckouts).set({ nextPollAt: new Date(Date.now() + 15_000) }).where(eq(cardCheckouts.id, id))
    })
    return this.view(await this.visible(principal, id), principal)
  }
  async cancel(principal: Principal, id: string) {
    const visible = await this.visible(principal, id)
    if (terminal.includes(visible.status)) return this.view(visible, principal)
    await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [current] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
      if (current?.rail === 'purchase' && current.status === 'awaiting_provider' && current.encryptedReplay) {
        const result = JSON.parse(this.api().open(current.encryptedReplay, `replay:${current.ownerId}:${id}`)) as BuyTurn
        // This completed confirm explicitly reported no charge and requires a NEW explicit
        // continuation. The owner lock prevents that continuation racing this cancellation.
        if (result.charge_status === 'none' && result.decline_code === 'vault_approval_required') await tx.update(cardCheckouts).set({ status: 'rejected', usdSettledMicros: '0' }).where(eq(cardCheckouts.id, id))
      }
      await tx.update(cardCheckouts).set({ cancelRequested: true, encryptedApprovalUrl: null, nextPollAt: new Date(0) }).where(eq(cardCheckouts.id, id))
      await tx.update(cardCheckouts).set({ status: 'rejected' }).where(and(eq(cardCheckouts.id, id), inArray(cardCheckouts.status, ['pending_approval', 'queued'])))
    })
    return this.get(principal, id)
  }
  private async turnRow(principal: Principal, id: string, db: Pick<OperationService['db'], 'select'> = this.service.db) {
    const [row] = await db.select().from(cardPurchaseTurns).where(and(eq(cardPurchaseTurns.id, id), eq(cardPurchaseTurns.ownerId, principal.ownerId), principal.kind === 'agent' ? eq(cardPurchaseTurns.grantId, principal.grantId) : undefined))
    if (!row) fail(404, 'not_found', 'Purchase conversation not found')
    return row
  }
  private turnView(row: typeof cardPurchaseTurns.$inferSelect): CardPurchaseTurn {
    const result = row.encryptedResult ? JSON.parse(this.api().open(row.encryptedResult, `turn-result:${row.ownerId}:${row.id}`)) as { reply?: string; carts?: unknown[]; cart?: unknown } : null
    const candidates = result?.carts?.length ? result.carts : result?.cart ? [result.cart] : []
    return { id: row.id, agentId: row.agentId, status: row.status, reply: result?.reply ?? null, carts: candidates.map(cart => purchaseCart.safeParse(cart)).flatMap(cart => cart.success ? [cart.data] : []), error: row.status === 'unknown' ? 'Turn result is uncertain. Read this conversation; do not repeat the ask automatically.' : null }
  }
  async askPurchase(principal: Principal, raw: unknown, key: string) {
    const input = purchaseAsk.parse(raw)
    if (!this.enabled) fail(503, 'checkout_disabled', 'Card purchases are disabled')
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail(400, 'idempotency_required', 'A stable idempotency key is required')
    const principalKey = principal.kind === 'owner' ? `owner:${principal.ownerId}` : `grant:${principal.grantId}`, requestHash = digest(input)
    const claim = await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [old] = await tx.select().from(cardPurchaseTurns).where(and(eq(cardPurchaseTurns.principalKey, principalKey), eq(cardPurchaseTurns.idempotencyKey, key)))
      if (old) { if (old.requestHash !== requestHash) fail(409, 'idempotency_conflict', 'This key belongs to another purchase turn'); return { row: old, fresh: false, user: '' } }
      const state = await this.authority(tx, principal, input.agentId)
      const parent = input.conversationId ? await this.turnRow(principal, input.conversationId, tx) : null
      if (parent && (parent.agentId !== input.agentId || parent.vaultId !== state.vault.id || !parent.providerConversationId || parent.status !== 'complete')) fail(409, 'conversation_unavailable', 'The previous turn is unresolved or belongs to a different agent/Vault')
      if (parent?.providerConversationId) {
        const [busy] = await tx.select({ id: cardPurchaseTurns.id }).from(cardPurchaseTurns).where(and(eq(cardPurchaseTurns.providerConversationId, parent.providerConversationId), inArray(cardPurchaseTurns.status, ['running', 'unknown'])))
        const [payment] = await tx.select({ id: cardCheckouts.id }).from(cardCheckouts).where(and(eq(cardCheckouts.ownerId, principal.ownerId), eq(cardCheckouts.intentId, `buy:${parent.providerConversationId}`), inArray(cardCheckouts.status, ['pending_approval', 'queued', 'submitting', 'awaiting_provider', 'unknown', 'confirmed'])))
        if (busy || payment) fail(409, 'conversation_busy', 'Reconcile the current turn/order before changing this conversation')
        const previous = JSON.parse(this.api().open(parent.encryptedInput, `turn-input:${parent.ownerId}:${parent.id}`)) as z.infer<typeof purchaseAsk>
        input.deliveryAddress ??= previous.deliveryAddress
      }
      const id = crypto.randomUUID()
      const [row] = await tx.insert(cardPurchaseTurns).values({ id, ownerId: principal.ownerId, agentId: input.agentId, grantId: principal.kind === 'agent' ? principal.grantId : null, vaultId: state.vault.id, principalKey, idempotencyKey: key, requestHash, providerConversationId: parent?.providerConversationId, encryptedInput: this.api().seal(JSON.stringify(input), `turn-input:${principal.ownerId}:${id}`), status: 'running' }).returning()
      return { row: row!, fresh: true, user: state.vault.userId }
    })
    if (!claim.fresh) return this.turnView(claim.row)
    try {
      const result = await this.api().buyAsk({ user_id: claim.user, ask: input.ask, ...(claim.row.providerConversationId ? { conversation_id: claim.row.providerConversationId } : {}), ...(input.deliveryAddress ? { delivery_address: input.deliveryAddress } : {}) })
      if (!/^conv_[A-Za-z0-9_-]{1,128}$/.test(result.conversation_id) || (claim.row.providerConversationId && result.conversation_id !== claim.row.providerConversationId)) throw Error('Conversation mismatch')
      await this.service.db.update(cardPurchaseTurns).set({ providerConversationId: result.conversation_id, encryptedResult: this.api().seal(JSON.stringify(result), `turn-result:${principal.ownerId}:${claim.row.id}`), status: result.error_code === 'turn_timeout' ? 'unknown' : 'complete' }).where(eq(cardPurchaseTurns.id, claim.row.id))
    } catch { await this.service.db.update(cardPurchaseTurns).set({ status: 'unknown' }).where(eq(cardPurchaseTurns.id, claim.row.id)) }
    return this.turnView(await this.turnRow(principal, claim.row.id))
  }
  async purchaseConversation(principal: Principal, id: string) {
    const row = await this.turnRow(principal, id)
    if (row.providerConversationId && row.status === 'unknown') {
      const state = await this.service.db.transaction(async tx => this.authority(tx, principal, row.agentId))
      if (state.vault.id !== row.vaultId) fail(409, 'vault_changed', 'Purchase belongs to another Vault')
      const result = await this.api().buyConversation(state.vault.userId, row.providerConversationId)
      if (!result.turn_in_progress) await this.service.db.update(cardPurchaseTurns).set({ status: 'complete', encryptedResult: this.api().seal(JSON.stringify(result), `turn-result:${principal.ownerId}:${id}`) }).where(eq(cardPurchaseTurns.id, id))
    }
    return this.turnView(await this.turnRow(principal, id))
  }
  async confirmPurchase(principal: Principal, raw: unknown, key: string) {
    const input = purchaseConfirm.parse(raw), turn = await this.turnRow(principal, input.conversationId)
    if (turn.agentId !== input.agentId || turn.status !== 'complete' || !turn.providerConversationId) fail(409, 'cart_unavailable', 'Read the completed turn before confirming')
    const cart = this.turnView(turn).carts.find(cart => cart.hash === input.cartHash)
    if (!cart) fail(409, 'cart_changed', 'Confirm the exact cart hash from this turn')
    const stored = JSON.parse(this.api().open(turn.encryptedInput, `turn-input:${turn.ownerId}:${turn.id}`)) as z.infer<typeof purchaseAsk>
    const payment: PurchaseInput = { agentId: input.agentId, merchant: cart.merchant_name, checkoutOrigin: 'https://api.agentcard.sh', amountMinor: cart.totalCents, currency: 'usd', purchase: { conversationId: turn.providerConversationId, turnId: turn.id, cart: purchaseCart.parse(cart), ...(stored.deliveryAddress ? { deliveryAddress: stored.deliveryAddress } : {}) } }
    const result = await this.reserve(principal, payment, key, `buy:${turn.providerConversationId}`)
    return result.newlyCreated && result.status === 'queued' ? this.execute(principal, result.id) : result
  }
  private async executePurchase(principal: Principal, row: Row, input: PurchaseInput, userId: string) {
    let dispatched = false
    try {
      const result = await this.api().buyConfirm({ user_id: userId, conversation_id: input.purchase.conversationId, confirm: input.purchase.cart.hash, ...(input.purchase.deliveryAddress ? { delivery_address: input.purchase.deliveryAddress } : {}) }, async () => {
        if (dispatched) fail(409, 'already_dispatched', 'A purchase confirmation is never resent automatically')
        await this.service.db.transaction(async tx => {
          await this.lock(tx, row.ownerId)
          const [live] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, row.id))
          if (!live || live.status !== 'submitting' || live.cancelRequested || live.expiresAt.getTime() <= Date.now()) fail(409, 'checkout_changed', 'Purchase authority changed before dispatch')
          await this.executionReason(tx, live)
          await tx.update(cardCheckouts).set({ providerId: input.purchase.conversationId, encryptedReplay: null }).where(eq(cardCheckouts.id, row.id))
        })
        dispatched = true
      })
      if (result.conversation_id !== input.purchase.conversationId) throw Error('Conversation mismatch')
      await this.service.db.transaction(async tx => {
        await this.lock(tx, row.ownerId)
        const [current] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, row.id))
        if (!current || terminal.includes(current.status)) return
        const waiting = result.decline_code === 'vault_approval_required' && result.charge_status === 'none'
        const unpaid = result.status === 'declined' && result.charge_status === 'none' && !waiting
        let encryptedApprovalUrl: string | null = null
        if (waiting && result.approval_url && !current.cancelRequested) {
          const url = new URL(result.approval_url)
          if (url.origin === 'https://vault.agentcard.sh' && !url.username && !url.password && !url.hash) encryptedApprovalUrl = this.api().seal(result.approval_url, `approval:${row.ownerId}:${row.id}`)
        }
        await tx.update(cardCheckouts).set({ status: unpaid ? 'failed' : waiting ? 'awaiting_provider' : 'unknown', usdSettledMicros: unpaid ? '0' : null, encryptedApprovalUrl, encryptedReplay: this.api().seal(JSON.stringify(result), `replay:${row.ownerId}:${row.id}`), details: { ...current.details, ...(result.order_id ? { orderId: result.order_id } : {}) }, nextPollAt: new Date(0), error: unpaid ? 'Provider declined without a charge' : waiting ? null : 'Order/payment is reconciling; do not confirm again' }).where(eq(cardCheckouts.id, row.id))
      })
    } catch {
      await this.service.db.update(cardCheckouts).set({ status: dispatched ? 'unknown' : 'failed', error: dispatched ? 'Purchase confirmation is uncertain; reservation retained. Read the existing conversation; never blindly repeat confirm.' : 'Purchase stopped before dispatch' }).where(and(eq(cardCheckouts.id, row.id), eq(cardCheckouts.status, 'submitting')))
    }
    return this.get(principal, row.id)
  }
  async continuePurchase(principal: Principal, id: string) {
    await this.visible(principal, id)
    if (!this.enabled) fail(503, 'checkout_disabled', 'Card purchases are disabled')
    const claim = await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
      if (!row || row.rail !== 'purchase' || row.status !== 'awaiting_provider' || !row.encryptedReplay || row.cancelRequested || row.expiresAt.getTime() <= Date.now()) fail(409, 'not_resumable', 'Only a documented unpaid approval pause can be continued')
      const result = JSON.parse(this.api().open(row.encryptedReplay, `replay:${row.ownerId}:${id}`)) as BuyTurn
      if (result.charge_status !== 'none' || result.decline_code !== 'vault_approval_required') fail(409, 'not_resumable', 'Reconcile the existing payment; do not repeat confirmation')
      const state = await this.executionReason(tx, row)
      const input = JSON.parse(this.api().open(row.encryptedRequest, `request:${row.ownerId}:${id}`)) as PurchaseInput
      const conversation = await this.api().buyConversation(state.vault.userId, input.purchase.conversationId)
      if (conversation.turn_in_progress || conversation.orders.length || !conversation.carts.some(cart => digest(purchaseCart.parse(cart)) === digest(input.purchase.cart))) fail(409, 'cart_changed', 'The conversation changed or already has an order; no confirmation sent')
      await tx.update(cardCheckouts).set({ status: 'submitting', encryptedReplay: null, encryptedApprovalUrl: null }).where(eq(cardCheckouts.id, id))
      return { row, input, user: state.vault.userId }
    })
    return this.executePurchase(principal, claim.row, claim.input, claim.user)
  }
  private async getPurchase(principal: Principal, row: Row) {
    if ((terminal.includes(row.status) && (row.status !== 'confirmed' || row.details.merchantOrderConfirmed)) || !row.providerId || row.nextPollAt.getTime() > Date.now()) return this.view(row, principal)
    const [claimed] = await this.service.db.update(cardCheckouts).set({ nextPollAt: new Date(Date.now() + 15_000) }).where(and(eq(cardCheckouts.id, row.id), lt(cardCheckouts.nextPollAt, new Date()))).returning()
    if (!claimed) return this.view(row, principal)
    try {
      const [vault] = await this.service.db.select().from(cardVaults).where(and(eq(cardVaults.id, row.vaultId), eq(cardVaults.provider, 'agentcard'), eq(cardVaults.clientFingerprint, this.api().fingerprint)))
      if (!vault) return this.view(row, principal)
      const result = await this.api().buyConversation(vault.userId, row.providerId)
      if (result.conversation_id !== row.providerId) throw Error('Conversation mismatch')
      if (result.orders.length) await this.service.db.transaction(async tx => {
        await this.lock(tx, row.ownerId)
        const [current] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, row.id))
        if (!current || (terminal.includes(current.status) && current.status !== 'confirmed')) return
        const order = result.orders[0]!
        if (result.orders.length !== 1 || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0 || (order.merchant_currency && order.merchant_currency.toLowerCase() !== 'usd')) {
          await tx.update(cardCheckouts).set({ status: 'unknown', budgetUnsafe: true, settledAt: new Date(), error: 'Order amounts/currency require reconciliation; new shared-budget spending is blocked' }).where(eq(cardCheckouts.id, row.id)); return
        }
        if (order.status !== 'settled') return
        const spent = BigInt(order.total_cents) * 10_000n
        await tx.update(cardCheckouts).set({ status: 'confirmed', usdSettledMicros: spent.toString(), budgetUnsafe: false, settledAt: current.settledAt ?? new Date(), encryptedApprovalUrl: null, details: { ...current.details, orderId: order.order_id ?? undefined, merchantOrderConfirmed: Boolean(order.confirmed_at) }, error: spent > BigInt(current.usdReservedMicros) ? overrunError : null }).where(eq(cardCheckouts.id, row.id))
      })
    } catch { /* A failed read is never permission to repeat a confirm or release its hold. */ }
    return this.view(await this.visible(principal, row.id), principal)
  }
  async browserRegistry(principal: Principal, agentId: string) {
    if (!this.enabled) fail(503, 'checkout_disabled', 'Card checkout is disabled')
    await this.service.db.transaction(async tx => this.authority(tx, principal, agentId))
    return this.api().registry()
  }
  async browserStep(principal: Principal, id: string, step: 'continuations' | 'duplicate-guard', body: Record<string, unknown>) {
    await this.visible(principal, id)
    const providerId = await this.service.db.transaction(async tx => {
      await this.lock(tx, principal.ownerId)
      const [row] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
      if (!row || row.rail !== 'browser' || !row.providerId || row.cancelRequested || !this.enabled || row.expiresAt.getTime() + replayRetentionMs <= Date.now()) fail(409, 'checkout_unavailable', 'Browser handoff is no longer active')
      await this.executionReason(tx, row)
      if (step === 'continuations') {
        if (terminal.includes(row.status)) fail(409, 'checkout_terminal', 'A settled or ended checkout cannot authorize another payment')
        if (row.details.continuationClaimed) fail(409, 'continuation_used', 'A continuation was already attempted; reconcile without replaying it')
        const request = body.request as { url?: unknown } | undefined
        if (typeof request?.url !== 'string' || !/^https:\/\/api\.stripe\.com\/v1\/payment_intents\/pi_[A-Za-z0-9]+\/confirm$/.test(request.url)) fail(400, 'unsupported_continuation', 'Only a provider-validated one-payment continuation is supported; no future-spend setup')
        await tx.update(cardCheckouts).set({ details: { ...row.details, continuationClaimed: true } }).where(eq(cardCheckouts.id, id))
      }
      return { id: row.providerId, amount: row.amountMinor }
    })
    const result = await this.api().browserStep(providerId.id, step, step === 'duplicate-guard' ? {} : body)
    if (step === 'continuations') {
      const payment = result.payment_intent as { amount?: unknown; currency?: unknown } | undefined
      if (payment?.currency !== 'usd' || !Number.isSafeInteger(payment.amount) || Math.abs(Number(payment.amount) - providerId.amount) > 1) fail(409, 'continuation_mismatch', 'The payment continuation differs from the reserved amount/currency')
    }
    return result
  }
  async tick() {
    if (!this.provider) return
    await this.service.db.update(cardCheckouts).set({ encryptedRequest: '', encryptedReplay: null, encryptedApprovalUrl: null }).where(purgeable())
    const rows = await this.service.db.select({ id: cardCheckouts.id, ownerId: cardCheckouts.ownerId }).from(cardCheckouts).where(and(eq(cardCheckouts.provider, 'agentcard'), inArray(cardCheckouts.status, ['pending_approval', 'queued', 'submitting', 'awaiting_provider', 'unknown']), lt(cardCheckouts.nextPollAt, new Date()))).orderBy(cardCheckouts.nextPollAt).limit(5)
    await Promise.all(rows.map(async row => { try { await this.get({ kind: 'owner', ownerId: row.ownerId }, row.id) } catch { /* Holds survive missing credentials, provider failures and restarts. */ } }))
  }
  async replay(principal: Principal, id: string) {
    if (!this.enabled) fail(503, 'checkout_disabled', 'Private browser handoff is disabled; payment metadata remains available')
    let row = await this.visible(principal, id)
    if (row.rail !== 'browser' || row.cancelRequested || ['failed', 'rejected', 'expired'].includes(row.status)) fail(409, 'replay_unavailable', 'This request has no active browser handoff')
    await this.service.db.transaction(async tx => { await this.lock(tx, row.ownerId); await this.executionReason(tx, row) })
    if (row.expiresAt.getTime() + replayRetentionMs <= Date.now()) fail(410, 'replay_expired', 'Private browser replay expired; inspect the settled payment and merchant order, never automatically purchase again')
    if (!row.encryptedReplay && row.providerId && row.status === 'confirmed') {
      const result = await this.api().authorization(row.providerId)
      await this.service.db.transaction(async tx => {
        await this.lock(tx, row.ownerId)
        const [current] = await tx.select().from(cardCheckouts).where(eq(cardCheckouts.id, id))
        if (current) await this.apply(tx, current, result)
      })
      row = await this.visible(principal, id)
    }
    if (!row.encryptedReplay) fail(409, 'replay_unavailable', 'Processor response is unavailable. Check payment status; do not repeat the purchase.')
    const state = JSON.parse(this.api().open(row.encryptedReplay, `replay:${row.ownerId}:${row.id}`)) as CardCheckoutReplay
    delete state.approval_url
    return { ...state, id: `cauth_${row.id.replaceAll('-', '')}`, approvalUrl: this.view(row, principal).approvalUrl }
  }
}

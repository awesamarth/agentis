import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { Agentcard, type BuyAskInput, type BuyConfirmInput } from '@agent-cards/sdk'
import { fail } from '../../errors'

const origin = 'https://api.agentcard.sh'
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const date = z.string().datetime({ offset: true })
const poll = z.number().int().min(1).max(300)
const token = z.object({ access_token: z.string().min(1).max(8192), expires_in: z.number().int().min(60).max(86_400) })
const sessionCreated = z.object({ id: providerId, url: z.string().url().max(8192), user_id: providerId.nullable(), expires_at: date, poll_interval: poll, test_mode: z.boolean() })
const sessionRead = z.object({ id: providerId, status: z.enum(['pending', 'linked', 'expired']), user_id: providerId.nullable(), expires_at: date, poll_interval: poll, test_mode: z.boolean() })
export const cardAuthorization = z.object({
  id: providerId, status: z.enum(['awaiting_approval', 'approved', 'submitted_on_device', 'declined', 'expired']),
  mode: z.string(), amount: z.number().int().nullable().optional(), currency: z.string().nullable().optional(),
  amount_authority: z.enum(['processor', 'agent', 'page', 'none']).optional(), replay_attempted: z.boolean().optional(),
  charged_kind: z.enum(['captured', 'authorized', 'none']).nullable().optional(), autopilot_status: z.string().max(80).optional(),
  approvalUrl: z.string().url().max(8192).optional(),
  settlement: z.object({ status: z.enum(['settled', 'not_settled', 'unknown']), final: z.boolean(), settled_amount: z.number().int().nonnegative().nullable().optional(), settled_currency: z.string().nullable().optional() }).nullable().optional(),
  response: z.object({ status: z.number().int().min(100).max(599), headers: z.record(z.string(), z.string()), body: z.string().max(128 * 1024) }).optional(),
}).passthrough()
const cards = z.object({ data: z.array(z.object({
  id: providerId, brand: z.string().regex(/^[a-zA-Z _-]{1,40}$/), last4: z.string().regex(/^\d{4}$/),
  expiry_month: z.number().int().min(1).max(12), expiry_year: z.number().int().min(2000).max(2200),
  // Provider permission is informational, never Agentis executor authority.
  payment_permission: z.object({ status: z.enum(['pending', 'active', 'revoked', 'retired', 'unavailable']), ready: z.boolean() }).optional(),
})).max(100) })

/** Fixed-origin, bounded, non-retrying server client. No organization credentials leave this module. */
export class AgentcardProvider {
  readonly fingerprint: string
  private access?: { value: string; expires: number }
  private exchange?: Promise<string>
  private shopping?: Agentcard
  private shoppingClient(beforeSend?: () => Promise<void>) {
    if (!beforeSend && this.shopping) return this.shopping
    const client = new Agentcard({ clientId: this.clientId, clientSecret: this.clientSecret, fetchImpl: Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input))
      if (url.origin !== origin) throw Error('Unsupported provider origin')
      if (url.pathname === '/buy' && init?.method === 'POST') await beforeSend?.()
      const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(140_000), ...(init?.signal ? [init.signal] : [])]) })
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
      try { if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1024 * 1024) throw Error('Provider response too large'); chunks.push(chunk.value) } }
      finally { await reader?.cancel().catch(() => {}) }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'content-type': 'application/json' } })
    }, { preconnect: () => {} }) })
    if (!beforeSend) this.shopping = client
    return client
  }
  async buyAsk(input: BuyAskInput) { try { return await this.shoppingClient().buy.ask(input) } catch { fail(502, 'purchase_provider_unavailable', 'Purchase turn did not complete. Inspect the existing conversation; do not blindly repeat it. The provider may require a separate user connection.') } }
  async buyConfirm(input: BuyConfirmInput, beforeSend: () => Promise<void>) { try { return await this.shoppingClient(beforeSend).buy.confirm({ ...input, payment_source: 'vault', approval: 'page' }) } catch { fail(502, 'purchase_outcome_unknown', 'Purchase outcome is unresolved. Reconcile the same conversation before any further confirmation.') } }
  async buyConversation(userId: string, conversationId: string) { try { return await this.shoppingClient().buy.conversation({ user_id: userId, conversation_id: conversationId }) } catch { fail(502, 'purchase_read_unavailable', 'Could not read this purchase conversation. Reservations remain held.') } }
  registry() { return this.call('/v2/checkout/recognizers?modes=token,cse,hosted_form,merchant_hosted,verifone,card_endpoint,device_encrypt&features=card_fields,checkout_sessions&merchant_profiles=1', z.unknown()) }
  constructor(private clientId: string, private clientSecret: string, private storageKey: Buffer) {
    this.fingerprint = createHash('sha256').update(clientId).digest('hex')
    if (storageKey.length !== 32) throw Error('Invalid card storage configuration')
  }
  static fromEnv() {
    const { AGENTCARD_CLIENT_ID: id, AGENTCARD_CLIENT_SECRET: secret, AGENTIS_CARD_STORAGE_KEY: key } = process.env
    if (!id || !secret || !key || !/^[a-fA-F0-9]{64}$/.test(key)) return null
    return new AgentcardProvider(id, secret, Buffer.from(key, 'hex'))
  }
  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit, base = origin): Promise<T> {
    try {
      const response = await fetch(`${base}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) })
      // Never pass provider bodies, URLs, tokens, or SDK exception messages into public errors/logs.
      if (!response.ok) { await response.body?.cancel(); fail(502, 'card_provider_unavailable', 'Card provider request failed. Do not repeat an uncertain request with a new key.') }
      if (!response.body) throw Error()
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break
          length += next.value.length
          if (length > 256 * 1024) throw Error()
          chunks.push(next.value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch { fail(502, 'card_provider_unavailable', 'Card provider unavailable or returned an unexpected response. Existing requests are not retried automatically.') }
  }
  private async bearer() {
    if (this.access && this.access.expires > Date.now()) return this.access.value
    this.exchange ??= this.request('/api/v2/oauth/token', token, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }),
    }).then(result => {
      this.access = { value: result.access_token, expires: Date.now() + (result.expires_in - 30) * 1000 }
      return result.access_token
    }).finally(() => { this.exchange = undefined })
    return this.exchange
  }
  private async call<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    return this.request(path, schema, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  async createSession(userId?: string) {
    const result = await this.call('/api/v2/vault_sessions', sessionCreated, { ...(userId ? { user_id: providerId.parse(userId) } : {}), expires_in: 1200, approval_mode: 'customer' })
    const url = new URL(result.url)
    if (url.origin !== 'https://vault.agentcard.sh' || url.username || url.password || url.hash) fail(502, 'invalid_card_link', 'Card provider returned an unsupported enrollment link')
    if (result.user_id !== (userId ?? null)) fail(502, 'invalid_card_user', 'Card provider returned an unexpected account')
    return result
  }
  readSession(id: string) { return this.call(`/api/v2/vault_sessions/${providerId.parse(id)}`, sessionRead) }
  async listCards(userId: string) {
    const result = await this.call(`/api/v2/vault_cards?user_id=${providerId.parse(userId)}`, cards)
    return result.data.map(card => ({ id: card.id, brand: card.brand, last4: card.last4, expiryMonth: card.expiry_month, expiryYear: card.expiry_year,
      providerPermission: card.payment_permission?.status ?? 'unavailable', providerAutoApproval: card.payment_permission?.ready ?? false }))
  }
  async createAuthorization(input: Record<string, unknown>, beforeSend: () => Promise<number>, onDispatch: () => void) {
    const token = await this.bearer()
    // OAuth can be slow. Recheck grant/policy/expiry AFTER it, immediately before the money-moving POST.
    const deadline = await beforeSend()
    if (Date.now() >= deadline) fail(409, 'approval_expired', 'Card approval or executor permission expired before dispatch')
    onDispatch()
    return this.request('/v2/checkout/authorizations', cardAuthorization, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })
  }
  authorization(id: string) { return this.call(`/api/v2/checkout/authorizations/${providerId.parse(id)}`, cardAuthorization) }
  cancelAuthorization(id: string) { return this.call(`/api/v2/checkout/authorizations/${providerId.parse(id)}/cancel`, z.unknown(), {}) }
  browserStep(id: string, step: 'continuations' | 'merchant_charge' | 'duplicate-guard', body: unknown) {
    return this.call(`/v2/checkout/authorizations/${providerId.parse(id)}/${step}`, z.record(z.string(), z.unknown()), body)
  }
  /** Short-lived bearer links and captured checkout material use row-bound authenticated encryption. */
  seal(value: string, context: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.storageKey, iv)
    cipher.setAAD(Buffer.from(`${this.fingerprint}:${context}`))
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
  }
  open(value: string, context: string) {
    try {
      const data = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.storageKey, data.subarray(0, 12))
      decipher.setAAD(Buffer.from(`${this.fingerprint}:${context}`)); decipher.setAuthTag(data.subarray(12, 28))
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
    } catch { fail(503, 'card_link_unavailable', 'Enrollment link is unavailable; preserve the existing request and wait for expiry before starting again') }
  }
}

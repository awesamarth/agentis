import { z } from 'zod'
import { createHash } from 'node:crypto'
import { fail } from '../../errors'

export const canonicalOrigin = z.string().url().max(512).refine(value => { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password })
export const minor = z.number().int().min(1).max(99_999_999)
// This is the official SDK's authorization payload, not a Stripe-specific request.
// The server replaces user/merchant/amount/currency; callers cannot select another person's Vault.
export const browserAuthorization = z.object({
  psp: z.string().regex(/^[a-z0-9_]{1,64}$/), mode: z.enum(['token', 'cse', 'hosted_form', 'merchant_hosted', 'verifone', 'card_endpoint', 'device_encrypt']),
  request: z.object({ url: z.string().url().max(8192), method: z.enum(['GET', 'POST', 'PUT']), headers: z.record(z.string().max(128), z.string().max(8192)), body: z.string().max(128 * 1024) }).passthrough(),
}).passthrough()
export const cardCheckoutInput = z.object({
  agentId: z.string().uuid(), merchant: z.string().min(1).max(120), checkoutOrigin: canonicalOrigin,
  amountMinor: minor, currency: z.literal('usd'), authorization: browserAuthorization,
}).strict()
export function checkoutTerms(raw: unknown) {
  const input = cardCheckoutInput.parse(raw)
  const payload = input.authorization
  if (payload.mode === 'device_encrypt') fail(400, 'future_spend_unsupported', 'Saving a card for future merchant charges is not an authorized one-time purchase')
  // Never accept caller-supplied provider user/grant/preparation authority. Customer approval/autopilot
  // is chosen by Agentcard's existing customer permission, not an Agentis-created partner grant.
  for (const key of ['grant_id', 'preparation_id', 'checkout_key']) if (payload[key] !== undefined) fail(400, 'unsupported_checkout_authority', 'Provider grant/preparation authority cannot be supplied by an executor')
  if (payload.execution_mode !== undefined && payload.execution_mode !== 'user_approval') fail(400, 'unsupported_checkout_authority', 'Explicit provider autopilot authority cannot be supplied by an executor')
  const url = new URL(payload.request.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail(400, 'invalid_card_request', 'Expected an HTTPS processor request')
  delete payload.user; delete payload.cardId; delete payload.merchant; delete payload.amount; delete payload.currency
  delete payload.checkout_origin; delete payload.merchant_origin
  const allowed = new Set(['psp', 'mode', 'request', 'execution_mode', 'page_amount', 'page_currency', 'pay_to_intercept_ms', 'merchant_hosted', 'verifone', 'merchant_card_endpoint'])
  if (Object.keys(payload).some(key => !allowed.has(key))) fail(400, 'unsupported_checkout_field', 'Unsupported SDK authorization field; provider identity and authority are server-owned')
  const intentId = `browser:${createHash('sha256').update(JSON.stringify([payload.psp, payload.request])).digest('hex')}`
  return { input, intentId }
}
export const deliveryAddress = z.object({
  street: z.string().min(1).max(200), city: z.string().min(1).max(100), state: z.string().regex(/^[A-Za-z]{2}$/), zip: z.string().min(3).max(12),
  address2: z.string().max(200).optional(), phone: z.string().max(30).optional(), name: z.string().max(120).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(), can_leave_at_door: z.boolean().optional(),
}).strict()
export const purchaseAsk = z.object({ agentId: z.string().uuid(), ask: z.string().min(1).max(4000), conversationId: z.string().uuid().optional(), deliveryAddress: deliveryAddress.optional() }).strict()
export const purchaseConfirm = z.object({ agentId: z.string().uuid(), conversationId: z.string().uuid(), cartHash: z.string().regex(/^[a-f0-9]{16}$/i) }).strict()
export const purchaseCart = z.object({
  hash: z.string().regex(/^[a-f0-9]{16}$/i), merchant: z.string().min(1).max(128), merchant_name: z.string().max(200),
  totalCents: minor, approvedCeilingCents: minor.nullable().optional(), serviceFeesCents: z.number().int().nonnegative().optional(), tipCents: z.number().int().nonnegative().optional(),
  items: z.array(z.object({ name: z.string().max(500), qty: z.number().int().positive(), priceCents: z.number().int().nonnegative().optional(), product_id: z.string().max(2048).nullable().optional() })).max(100),
}).refine(cart => (cart.approvedCeilingCents ?? cart.totalCents) >= cart.totalCents)
export type BrowserInput = z.infer<typeof cardCheckoutInput>
export type PurchaseInput = { agentId: string; merchant: string; checkoutOrigin: string; amountMinor: number; currency: 'usd'; purchase: { conversationId: string; turnId: string; cart: z.infer<typeof purchaseCart>; deliveryAddress?: z.infer<typeof deliveryAddress> } }
export type CheckoutInput = BrowserInput | PurchaseInput

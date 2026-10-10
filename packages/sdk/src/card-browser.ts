import { VaultClient } from '@agent-cards/sdk'
import { attachToPlaywright, type AttachOptions } from '@agent-cards/sdk/cdp'
import type { AgentisClient } from './client'
import type { CardCheckout, CardCheckoutInput } from './card-checkout'

export type CardBrowserOptions = {
  client: AgentisClient; agentId: string; merchant: string; amountMinor: number; idempotencyKey: string
  signal?: AbortSignal; timeoutMs?: number
  onApprovalUrl?: (url: string) => void; onCheckout?: (checkout: CardCheckout) => void
}
/**
 * Official Agentcard interception, recognizers, iframe handling and mode-specific replay.
 * Its transport is scoped through Agentis: no organization credentials enter the harness.
 * Ask waits for Agentis review; Auto skips that review, never Agentcard/bank requirements.
 * Prepared/native-checkout and future-spend APIs are deliberately not exposed by this bridge.
 * This does not drive shopping. Keep the page alive and verify the merchant's order separately.
 */
export async function attachCardCheckout(page: Parameters<typeof attachToPlaywright>[0], options: CardBrowserOptions) {
  if (!Number.isSafeInteger(options.amountMinor) || options.amountMinor < 1 || options.amountMinor > 99_999_999 || !/^[A-Za-z0-9._:-]{1,128}$/.test(options.idempotencyKey)) throw Error('Invalid checkout amount or idempotency key')
  let checkout: CardCheckout | undefined, attempted = false, dispatched = false
  let mode = 'token'
  const notify = (value: CardCheckout) => {
    checkout = value
    const { providerApprovalUrl: _private, ...metadata } = value
    try { options.onCheckout?.(metadata) } catch { /* Observers cannot retry a payment. */ }
  }
  const localId = () => checkout ? `cauth_${checkout.id.replaceAll('-', '')}` : ''
  const pending = () => ({ id: localId(), status: checkout && ['rejected', 'failed', 'expired'].includes(checkout.status) ? 'declined' : 'awaiting_approval', mode, amount: options.amountMinor, currency: 'usd', ...(checkout?.status === 'pending_approval' ? { approvalUrl: checkout.approvalUrl } : {}) })
  const cancel = async () => { if (checkout) notify(await options.client.cards.checkouts.cancel(checkout.id)) }
  options.signal?.addEventListener('abort', () => { void cancel().catch(() => {}) }, { once: true })
  const vault = new VaultClient({
    clientId: 'agentis-scoped-transport', clientSecret: 'not-a-provider-credential', baseUrl: 'https://agentis.invalid',
    pollIntervalMs: 2500, unverifiableRetryDelaysMs: [],
    fetchImpl: Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const path = new URL(String(input)).pathname, method = init?.method ?? 'GET'
      if (path === '/api/v1/oauth/token') return Response.json({ access_token: 'agentis-transport', expires_in: 3600, token_type: 'Bearer' })
      if (path === '/v2/checkout/recognizers' && method === 'GET') return Response.json(await options.client.cards.checkouts.registry(options.agentId))
      if (path === '/v2/checkout/authorizations' && method === 'POST') {
        options.signal?.throwIfAborted()
        if (attempted) throw Error('This browser purchase was already attempted; inspect its existing operation')
        attempted = true
        const authorization = JSON.parse(String(init?.body)) as CardCheckoutInput['authorization']
        mode = authorization.mode
        const origin = new URL(page.url()).origin
        const created = await options.client.cards.checkouts.create({ agentId: options.agentId, merchant: options.merchant, checkoutOrigin: origin, amountMinor: options.amountMinor, currency: 'usd', authorization }, { idempotencyKey: options.idempotencyKey })
        notify(created)
        if (!created.newlyCreated) throw Error('This key already has a checkout. No new payment or browser replay was attempted.')
        return Response.json(pending())
      }
      const match = /^\/v2\/checkout\/authorizations\/(cauth_[A-Za-z0-9_-]+)(?:\/(cancel|continuations|duplicate-guard))?$/.exec(path)
      if (!checkout || !match || match[1] !== localId()) throw Error('This SDK capability is not exposed by the Agentis card transport')
      if (method === 'POST' && match[2] === 'cancel') {
        await cancel()
        if (checkout.status !== 'rejected') return Response.json({ code: 'outcome_unknown' }, { status: 409 })
        return Response.json({ id: localId(), status: 'declined', cancelled: true, reason: 'merchant_request_aborted', processor_request_started: false })
      }
      if (method === 'POST' && (match[2] === 'continuations' || match[2] === 'duplicate-guard')) {
        const result = await options.client.cards.checkouts.browserStep(checkout.id, match[2], JSON.parse(String(init?.body ?? '{}')))
        return Response.json({ ...result, ...(result.id ? { id: localId() } : {}), ...(result.authorization_id ? { authorization_id: localId() } : {}), ...(result.authorization ? { authorization: localId() } : {}) })
      }
      if (method !== 'GET' || match[2]) throw Error('Unsupported card SDK transport request')
      notify(await options.client.cards.checkouts.get(checkout.id))
      if (checkout.status === 'queued' && !dispatched) {
        options.signal?.throwIfAborted()
        dispatched = true
        // A lost execute response never causes another execute call.
        try { notify(await options.client.cards.checkouts.execute(checkout.id)) } catch { notify(await options.client.cards.checkouts.get(checkout.id)) }
      }
      if (['pending_approval', 'queued', 'submitting', 'rejected', 'failed', 'expired'].includes(checkout.status)) return Response.json(pending())
      try { return Response.json(await options.client.cards.checkouts.replay(checkout.id)) }
      catch { return Response.json(pending()) }
    }, { preconnect: () => {} }),
  })
  await vault.syncRegistry()
  const attach: AttachOptions = { vault, user: 'agentis-owner-vault', merchant: options.merchant, amount: options.amountMinor, currency: 'usd', timeoutMs: options.timeoutMs ?? 900_000,
    onApprovalUrl: url => { try { options.onApprovalUrl?.(url) } catch {} },
  }
  try { return await attachToPlaywright(page, attach) }
  catch { throw Error('Could not attach Agentcard to this browser. No automatic payment retry.') }
}

/** Create the safe default context, then shop using the returned page. */
export async function createCardCheckoutContext<T extends { newPage(): Promise<Parameters<typeof attachToPlaywright>[0]>; close(): Promise<void> }>(browser: { newContext(options: { serviceWorkers: 'block' }): Promise<T> }, options: CardBrowserOptions) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const page = await context.newPage()
    const controller = await attachCardCheckout(page, options)
    return { context, page, controller }
  } catch { await context.close().catch(() => {}); throw Error('Could not create the Agentcard checkout context') }
}

/** Placeholder only. The owner enters real card details exclusively at Agentcard. */
export const cardCheckoutPlaceholder = { number: '4242424242424242', cvc: '123', expiryMonth: '12', expiryYear: '2035' } as const

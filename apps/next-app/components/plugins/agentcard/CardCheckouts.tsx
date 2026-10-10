'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import { useAgentisClient } from '@/lib/agentis'
import type { CardCheckout } from '@agentis-hq/sdk'

const money = (micros: string) => `$${(Number(micros) / 1_000_000).toFixed(2)}`
export default function CardCheckouts({ agentId, enabled, connected }: { agentId: string; enabled: boolean; connected: boolean }) {
  const client = useAgentisClient('Sign in first'), { user } = usePrivy(), cache = useQueryClient()
  const queryKey = ['card-checkouts', user?.id, agentId]
  const checkouts = useQuery({ queryKey, queryFn: () => client.cards.checkouts.list(agentId), refetchInterval: 5000, retry: false, gcTime: 0 })
  const grants = useQuery({ queryKey: ['card-keys', user?.id], queryFn: () => client.grants.list(), enabled: enabled && connected })
  const permissions = useQuery({ queryKey: ['card-permissions', user?.id, agentId], queryFn: () => client.cards.permissions.list(agentId), enabled: enabled && connected })
  const permission = useMutation({ mutationFn: ({ grantId, enabled }: { grantId: string; enabled: boolean }) => client.cards.permissions.set({ grantId, enabled, confirm: true, scope: 'card_purchases_follow_agent_policy' }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['card-permissions', user?.id, agentId] }); void cache.invalidateQueries({ queryKey }) } })
  const action = useMutation({
    mutationFn: async ({ checkout, action }: { checkout: CardCheckout; action: 'approve' | 'reject' | 'cancel' | 'refresh' | 'continue' | 'execute' }) => {
      if (action === 'refresh') return client.cards.checkouts.get(checkout.id)
      if (action === 'cancel') return client.cards.checkouts.cancel(checkout.id)
      if (action === 'continue') return client.cards.purchases.continue(checkout.id)
      if (action === 'execute') return client.cards.checkouts.execute(checkout.id)
      const result = await client.cards.checkouts.decide(checkout.id, checkout.operationHash, action === 'approve')
      return action === 'approve' && checkout.rail === 'purchase' ? client.cards.checkouts.execute(checkout.id) : result
    },
    onSuccess: () => { void cache.invalidateQueries({ queryKey }); void cache.invalidateQueries({ queryKey: ['profile'] }) },
  })
  const error = action.error ?? permission.error ?? checkouts.error ?? permissions.error ?? grants.error
  return <section id="card-checkouts" className="space-y-4 border-t border-beige-darker pt-4">
    <h3 className="font-mono text-xs uppercase tracking-wide">Purchases</h3>
    <p className="text-xs text-ink-muted">{enabled ? 'Ask mode waits for your approval. Auto follows your agent’s limits. Agentcard or your bank may still ask you to approve.' : 'Purchases are currently disabled. You can still view past requests.'}</p>
    <p className="text-xs text-ink-muted">Card and crypto purchases share this agent’s USD budget. A paid charge doesn’t always mean the merchant has confirmed your order.</p>
    {enabled && <p className="text-xs text-ink-muted">Experimental browser access: use only a trusted harness. Provider token-reuse restrictions are not independently verified; the Agentis ledger does not constrain off-platform reuse of a payment credential.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
    {enabled && connected && <div className="space-y-2">
      <p className="text-sm">Allow specific keys to make purchases using your Vault under this agent’s Ask/Auto mode and USD limits. Keys cannot approve requests or retrieve your card details.</p>
      {grants.data?.filter(grant => grant.agentId === agentId && !grant.revokedAt && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now())).map(grant => {
        const allowed = permissions.data?.some(permission => permission.grantId === grant.id && permission.enabled) ?? false
        return <label key={grant.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowed} disabled={permission.isPending || permissions.isPending} onChange={event => {
          const enabled = event.target.checked
          if (!enabled || window.confirm(`Allow ${grant.name} to use your Vault for browser and delegated purchases? In Ask you review each purchase. In Auto it may submit purchases within this agent’s limits without another Agentis prompt. Agentcard/bank restrictions still apply.`)) permission.mutate({ grantId: grant.id, enabled })
        }} /><span>{grant.name}</span><span className="font-mono text-[0.65rem] text-ink-muted">{grant.id.slice(0, 8)}</span></label>
      })}
    </div>}
    {checkouts.data?.map(checkout => <article key={checkout.id} className="space-y-3 border border-beige-darker p-4">
      <div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{checkout.merchant}</strong><span className="font-mono text-xs">{checkout.status.replaceAll('_', ' ')}</span></div>
      <p className="break-all text-xs text-ink-muted">{checkout.rail === 'purchase' ? 'Cart from Agentcard’s Purchase API; the exact cart hash is bound to this request.' : `Reported merchant origin: ${checkout.checkoutOrigin}. Browser-supplied merchant context is not independent merchant verification.`}</p>
      <div className="font-mono text-xs">Requested ${(checkout.amountMinor / 100).toFixed(2)} USD · ceiling {money(checkout.usdReservedMicros)}{checkout.usdSettledMicros !== null ? ` · settled ${money(checkout.usdSettledMicros)}` : ''}</div>
      <p className="break-all font-mono text-xs text-ink-muted">{checkout.rail === 'purchase' ? 'Purchase conversation' : 'Browser request'}: {checkout.processorIntentId}</p>
      <p className="text-xs text-ink-muted">{new Date(checkout.createdAt).toLocaleString()} · {checkout.id}</p>
      {checkout.cart && <ul className="text-xs">{checkout.cart.items.map((item, index) => <li key={index}>{item.qty} × {item.name}</li>)}</ul>}
      {checkout.rail === 'purchase' && <p className="text-xs text-ink-muted">Delivery: {checkout.deliveryAddress ? [checkout.deliveryAddress.name, checkout.deliveryAddress.street, checkout.deliveryAddress.address2, checkout.deliveryAddress.city, checkout.deliveryAddress.state, checkout.deliveryAddress.zip, checkout.deliveryAddress.country].filter(Boolean).join(', ') : 'No structured address supplied; inspect the provider’s selected destination before approval.'}</p>}
      {checkout.orderId && <p className="break-all font-mono text-xs">Order: {checkout.orderId} · {checkout.merchantOrderConfirmed ? 'merchant confirmed' : 'merchant confirmation pending'}</p>}
      {checkout.error && <p className="text-xs text-ink-muted">{checkout.error}</p>}
      <div className="flex flex-wrap gap-3 font-mono text-xs">
        {checkout.status === 'pending_approval' && <>
          <button disabled={action.isPending || !enabled} onClick={() => { if (window.confirm(`Approve ${checkout.rail} purchase ${checkout.processorIntentId} up to ${money(checkout.usdReservedMicros)} USD? Reported merchant label (not independently verified): ${checkout.merchant}. Agentcard can then execute the reviewed purchase. Issuer fees are separate.`)) action.mutate({ checkout, action: 'approve' }) }} className="border border-ink px-3 py-2 disabled:opacity-40">Approve ceiling</button>
          <button disabled={action.isPending} onClick={() => action.mutate({ checkout, action: 'reject' })} className="underline">Reject</button>
        </>}
        {checkout.rail === 'purchase' && checkout.status === 'queued' && <button disabled={action.isPending || !enabled} onClick={() => action.mutate({ checkout, action: 'execute' })} className="underline">Place approved order</button>}
        {checkout.rail === 'purchase' && checkout.status === 'awaiting_provider' && checkout.providerApprovalUrl && <button disabled={action.isPending || !enabled} onClick={() => { if (window.confirm('Have you completed Agentcard approval? Continue the exact unpaid cart confirmation; this may place the order.')) action.mutate({ checkout, action: 'continue' }) }} className="underline">I approved at Agentcard — continue</button>}
        {checkout.providerApprovalUrl && <a href={checkout.providerApprovalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="border border-ink px-3 py-2">Continue securely at Agentcard →</a>}
        {!['confirmed', 'failed', 'rejected', 'expired'].includes(checkout.status) && <button disabled={action.isPending} onClick={() => action.mutate({ checkout, action: 'cancel' })} className="underline">Request cancellation</button>}
        <button disabled={action.isPending} onClick={() => action.mutate({ checkout, action: 'refresh' })} className="underline">Check settlement</button>
      </div>
      {checkout.status === 'confirmed' && <p className="text-xs text-ink-muted">Payment settled. Verify the order in the merchant’s page; do not pay again merely because its receipt is missing.</p>}
    </article>)}
  </section>
}

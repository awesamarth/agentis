'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CardSession } from '@agentis-hq/sdk'
import { useAgentisClient } from '@/lib/agentis'
import CardCheckouts from './CardCheckouts'

export default function CardConnections({ agentId }: { agentId: string }) {
  const { user } = usePrivy()
  return user ? <OwnerCards key={`${user.id}:${agentId}`} ownerId={user.id} agentId={agentId} /> : null
}
// Open during the click, before awaiting the API, so browsers can allow the new tab.
function openVaultTab(): Window | null {
  try {
    const tab = window.open('about:blank', '_blank')
    if (tab) {
      tab.opener = null
      tab.document.title = 'Opening Agentcard…'
      const policy = tab.document.createElement('meta')
      policy.name = 'referrer'; policy.content = 'no-referrer'; tab.document.head.append(policy)
      tab.document.body.textContent = 'Opening Agentcard… When you finish adding your card, close this tab to return to Agentis.'
      tab.document.body.style.cssText = 'background:#faf7f1;color:#292524;font:16px system-ui;padding:32px;line-height:1.6'
    }
    return tab
  } catch { return null }
}
function closeLoadingTab(tab: Window | null) {
  try { if (tab && !tab.closed && tab.location.href === 'about:blank') tab.close() } catch { /* Never close a tab the user navigated elsewhere. */ }
}
function OwnerCards({ ownerId, agentId }: { ownerId: string; agentId: string }) {
  const client = useAgentisClient('Sign in to connect cards'), cache = useQueryClient()
  const [consent, setConsent] = useState(false), [sessionId, setSessionId] = useState<string | null>(null)
  const requestKey = useRef<string | null>(null)
  const vaultKey = ['card-vault', ownerId]
  const vault = useQuery({ queryKey: vaultKey, queryFn: () => client.cards.vault(), retry: false, refetchOnWindowFocus: 'always', gcTime: 0 })
  const activeId = sessionId ?? vault.data?.session?.id
  const session = useQuery({
    queryKey: ['card-session', ownerId, activeId], queryFn: () => client.cards.session(activeId!), enabled: Boolean(activeId), retry: false,
    refetchInterval: query => ['creating', 'pending', 'unknown'].includes(query.state.data?.status ?? '') ? Math.max(3000, query.state.data!.pollAfterMs) : false,
    refetchOnWindowFocus: 'always', refetchIntervalInBackground: true, gcTime: 0,
  })
  const current: CardSession | undefined = session.data ?? vault.data?.session ?? undefined
  const active = current && ['creating', 'pending', 'unknown'].includes(current.status)
  useEffect(() => {
    if (session.data?.status === 'linked') { setConsent(false); requestKey.current = null; void cache.invalidateQueries({ queryKey: vaultKey }) }
    if (session.data && ['expired', 'cancelled'].includes(session.data.status)) requestKey.current = null
  // Depend on state transitions, not every polling response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data?.status, cache, ownerId])
  const connect = useMutation({
    mutationFn: (_tab: Window | null) => {
      requestKey.current ??= crypto.randomUUID()
      return client.cards.connect({ idempotencyKey: requestKey.current, confirm: true })
    },
    onSuccess: (result, tab) => {
      setSessionId(result.id); cache.setQueryData(['card-session', ownerId, result.id], result); void cache.invalidateQueries({ queryKey: vaultKey })
      if (result.status === 'pending' && result.enrollmentUrl && tab && !tab.closed) {
        try {
          const url = new URL(result.enrollmentUrl)
          if (url.origin !== 'https://vault.agentcard.sh' || url.username || url.password || url.hash) throw Error('Unsupported Vault link')
          if (tab.location.href === 'about:blank') tab.location.replace(result.enrollmentUrl)
        } catch { closeLoadingTab(tab) }
      } else closeLoadingTab(tab)
      // If popups were blocked or the tab was closed, the same session's link stays below.
    },
    onError: (_error, tab) => { closeLoadingTab(tab); void cache.invalidateQueries({ queryKey: vaultKey }) },
  })
  const disconnect = useMutation({
    mutationFn: () => client.cards.disconnect({ confirm: true }),
    onSuccess: () => { setSessionId(null); setConsent(false); requestKey.current = null; cache.removeQueries({ queryKey: ['card-session', ownerId] }); void cache.invalidateQueries({ queryKey: vaultKey }) },
  })
  const error = connect.error ?? disconnect.error ?? session.error ?? vault.error
  return <section id="cards" className="mt-5 scroll-mt-20 border-t border-beige-darker pt-4">
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-xs uppercase tracking-wide">Your cards</h4>
        <div className="flex items-center gap-3"><span className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-muted">Agentcard Vault</span>{vault.data?.connected && <button disabled={vault.isFetching} onClick={() => void vault.refetch()} className="font-mono text-xs underline disabled:opacity-40">{vault.isFetching ? 'Refreshing…' : 'Refresh cards'}</button>}</div>
      </header>
      <p className="text-sm text-ink-muted">Agentcard opens in a new tab to add your card securely. Close that tab when you’re done—your card list refreshes when you return.</p>
      <p className="border-l-2 border-ink pl-3 text-sm">Connect your card and allow this agent to make purchases. Your spending limits and Ask/Auto settings still apply.</p>
      {vault.isPending && <p role="status" className="text-sm">Loading card connection…</p>}
      {vault.data && !vault.data.configured && <p className="text-sm text-ink-muted">Card connections are not configured on this server.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      {vault.data?.configured && <>
        {vault.data.connected && <div className="space-y-2">
          <p className="font-mono text-xs">{vault.data.testMode ? 'Sandbox Vault connected' : 'Vault connected'} · owner account</p>
          {vault.data.cards.length ? vault.data.cards.map(card => <div key={card.id} className="flex flex-wrap justify-between gap-2 border border-beige-darker p-3 text-sm">
            <span className="capitalize">{card.brand} ···· {card.last4}</span>
            <span className="font-mono text-xs text-ink-muted">{String(card.expiryMonth).padStart(2, '0')}/{String(card.expiryYear).slice(-2)}</span>
            {card.providerAutoApproval && <p className="w-full text-xs text-ink-muted">Agentcard reports a ready payment permission. Agentis consent, agent limits and bank restrictions still apply.</p>}
          </div>) : <p className="text-sm text-ink-muted">No stored cards were returned. Finish adding a card in the Vault.</p>}
        </div>}
        {active ? <div className="space-y-2">
          <p role="status" className="text-sm">{current.status === 'pending' ? 'Finish adding your card in the Agentcard tab, then close it to return here. We’ll check your connection automatically.' : 'Enrollment outcome is pending or uncertain. Keep this request; do not create another link.'}</p>
          {current.enrollmentUrl && <a href={current.enrollmentUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-block border border-ink px-4 py-2 font-mono text-xs hover:bg-beige-dark">Open secure Vault ↗</a>}
          <p className="text-xs text-ink-muted">This private link expires {new Date(current.expiresAt).toLocaleString()}. Do not share it with an agent or another person.</p>
          {session.error && <button onClick={() => void session.refetch()} className="font-mono text-xs underline">Check existing enrollment</button>}
        </div> : <div className="space-y-3">
          {current?.status === 'linked' && <p role="status" className="text-sm">Vault account connected.</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" /><span>I want to connect my card through Agentcard. This does not authorize an agent purchase or request app auto-approval.</span></label>
          <button disabled={!consent || connect.isPending || disconnect.isPending} onClick={() => connect.mutate(openVaultTab())} className="border border-ink px-4 py-2 font-mono text-xs hover:bg-beige-dark disabled:opacity-40">{connect.isPending ? 'Opening Agentcard…' : vault.data.connected ? 'Add or manage cards ↗' : 'Connect a card ↗'}</button>
        </div>}
        {(vault.data.connected || active) && <div className="border-t border-beige-darker pt-3">
          <button disabled={disconnect.isPending || connect.isPending} onClick={() => { if (window.confirm('Disconnect Agentis and discard pending enrollment links? This does not delete cards or revoke permissions at Agentcard. Manage those in the Vault.')) disconnect.mutate() }} className="font-mono text-xs underline disabled:opacity-40">Disconnect from Agentis</button>
          <p className="mt-2 text-xs text-ink-muted">Disconnecting here does not delete vaulted cards or revoke Agentcard permissions. Manage those directly in your Vault.</p>
        </div>}
      </>}
      {vault.data && <CardCheckouts agentId={agentId} enabled={vault.data.checkoutEnabled} connected={vault.data.connected} />}
    </div>
  </section>
}

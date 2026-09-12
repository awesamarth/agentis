'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentisClient } from '@agentis-hq/sdk'
import { useRef, useState } from 'react'
import Dropdown from './Dropdown'
import MultiSelect from './MultiSelect'

const accessSource = (name: string) => /^(CLI|MCP|SDK)\s*·/i.exec(name)?.[1].toUpperCase()
const dialogButton = 'px-4 py-2.5 font-mono text-xs uppercase tracking-widest disabled:opacity-40'

export default function WalletAccess({ agentId }: { agentId: string }) {
  const { ready, authenticated, getAccessToken, user } = usePrivy()
  const cache = useQueryClient()
  const [chainIds, setChainIds] = useState<string[]>([])
  const [scope, setScope] = useState('all')
  const [newKey, setNewKey] = useState<{ owner: string; token: string } | null>(null)
  const [message, setMessage] = useState('')
  const revokeDialog = useRef<HTMLDialogElement>(null)
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; source?: string; networks: string; ownerId: string; agentId: string } | null>(null)
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  const enabled = ready && authenticated
  const wallets = useQuery({ queryKey: ['wallets', user?.id], enabled, queryFn: () => client.wallets.list() })
  const agents = useQuery({ queryKey: ['agents', user?.id], enabled, queryFn: () => client.agents.list() })
  const networks = useQuery({ queryKey: ['onboarding', user?.id], enabled, queryFn: () => client.onboarding.get() })
  const keys = useQuery({ queryKey: ['access-keys', user?.id], enabled, queryFn: () => client.grants.list() })
  const available = wallets.data?.filter(w => w.enabled && w.agentId === agentId) ?? []
  const choices = networks.data?.networks.filter(n => available.some(w => w.chainId === n.chainId)) ?? []
  const selectedChains = chainIds.filter(id => choices.some(n => n.chainId === id))
  const agent = agents.data?.find(a => a.id === agentId)
  const action = useMutation({ mutationFn: async (input: { revokeId: string } | { create: true }) => {
    if ('revokeId' in input) { await client.grants.revoke(input.revokeId); return }
    if (!agent || !user || (scope !== 'all' && selectedChains.length === 0)) throw new Error('Choose an enabled network first')
    const key = await client.grants.create({ agentId, ...(scope === 'all' ? {} : { chainIds: selectedChains }), agentName: agent.name })
    setNewKey({ owner: user.id, token: key.token }); setMessage('')
  }, onSuccess: async (_result, input) => {
    if ('revokeId' in input) revokeDialog.current?.close()
    await cache.invalidateQueries({ queryKey: ['access-keys', user?.id] })
    if ('revokeId' in input) await cache.invalidateQueries({ queryKey: ['operations'] })
  } })
  if (!enabled) return null
  const error = wallets.error ?? agents.error ?? networks.error ?? keys.error ?? action.error
  return <section id="api-access" className="scroll-mt-8">
    <h2 className="mb-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">API access</h2>
    <div className="space-y-5 border border-beige-darker bg-white p-6">
      <p className="font-mono text-xs leading-relaxed text-ink-muted">Connect this agent through the SDK or CLI. Keys remain valid until revoked and follow this agent’s rules. They cannot access other agents, change settings or approve payments. All networks includes networks you enable later; specific selections do not.</p>
      {available.length > 0 ? <><div className="grid gap-4 text-xs sm:grid-cols-2">
        <Dropdown label="Access" value={scope} onChange={setScope} disabled={action.isPending} options={[{ value: 'all', label: 'All networks' }, { value: 'network', label: 'Specific network(s)' }]} />
        {scope === 'network' && <MultiSelect label="Networks" values={selectedChains} onChange={setChainIds} disabled={action.isPending} options={choices.map(n => ({ value: n.chainId, label: n.name }))} />}
      </div><button disabled={action.isPending || !agent || (scope !== 'all' && selectedChains.length === 0)} onClick={() => action.mutate({ create: true })} className="border border-beige-darker px-4 py-2 font-mono text-xs tracking-widest text-ink-muted hover:border-ink hover:text-ink disabled:opacity-40">{action.isPending ? 'working…' : 'create access key'}</button></> : <p className="text-sm text-ink-muted">{wallets.isPending ? 'Loading wallets…' : 'Enable a network for this agent to create an access key.'}</p>}
      {newKey && newKey.owner === user?.id && <div className="space-y-3 border border-beige-darker bg-beige p-4">
        <p className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">Copy now — this key won’t be shown again</p>
        <code className="block break-all text-xs">{newKey.token}</code>
        <div className="flex flex-wrap gap-2 font-mono text-xs"><button type="button" className="border border-ink bg-ink px-4 py-2 text-beige hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" onClick={async () => { try { await navigator.clipboard.writeText(newKey.token); setMessage('Copied') } catch { setMessage('Could not copy. Select the key to copy manually.') } }}>copy key</button><button type="button" className="border border-ink px-4 py-2 text-ink hover:bg-beige-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" onClick={() => { setNewKey(null); setMessage('') }}>hide</button></div>
        <p role="status" className="text-xs text-ink-muted">{message}</p>
      </div>}
      <div className="divide-y divide-beige-darker">{keys.data?.filter(key => (key.agentId === agentId || wallets.data?.some(w => w.id === key.walletId && w.agentId === agentId)) && !key.revokedAt && (key.expiresAt === null || Date.parse(key.expiresAt) > keys.dataUpdatedAt)).map(key => {
        const wallet = wallets.data?.find(w => w.id === key.walletId)
        const source = accessSource(key.name)
        const networkNames = key.chainIds ? key.chainIds.map(id => networks.data?.networks.find(n => n.chainId === id)?.name ?? id).join(', ') : key.agentId ? 'All networks' : networks.data?.networks.find(n => n.chainId === wallet?.chainId)?.name ?? 'Specific network'
        return <div key={key.id} className="flex items-center justify-between gap-4 py-3 text-xs"><div className="min-w-0"><p className="break-words font-mono">{networkNames}{source && <span title={`Access issued via ${source}`} className="ml-2 inline-block align-middle border border-beige-darker bg-beige px-2 py-0.5 font-mono text-[10px] tracking-widest">{source}</span>}</p><p className="mt-1 text-ink-muted">{source === 'MCP' && <>{key.name.replace(/^MCP ·\s*/, '')} · </>}{key.expiresAt ? `Expires ${new Date(key.expiresAt).toLocaleString()}` : 'No expiry · valid until revoked'}</p></div><button type="button" className="font-mono text-red-700 underline underline-offset-4 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40" disabled={action.isPending} onClick={() => { if (!user) return; setNewKey(null); setMessage(''); action.reset(); setRevokeTarget({ id: key.id, source, networks: networkNames, ownerId: user.id, agentId }); revokeDialog.current?.showModal() }}>revoke</button></div>
      })}</div>
      {error && <p role="alert" className="text-sm text-ink-muted">{error.message}</p>}
    </div>
    <dialog ref={revokeDialog} aria-labelledby="revoke-access-title" aria-describedby="revoke-access-description" onClose={() => setRevokeTarget(null)} onCancel={event => { if (action.isPending) event.preventDefault() }} onClick={event => {
      if (action.isPending || event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50 sm:p-8">
      <header className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">API access</p><h2 id="revoke-access-title" className="mt-3 font-serif text-2xl font-bold">Revoke {revokeTarget?.source ? `${revokeTarget.source} access` : 'access key'}?</h2></div><button type="button" aria-label="Close confirmation" disabled={action.isPending} onClick={() => revokeDialog.current?.close()} className="p-1 text-2xl disabled:opacity-40">×</button></header>
      <div className="my-5 border border-beige-darker bg-white p-4"><p className="break-words font-serif text-lg font-bold">{agent?.name}</p><p className="mt-2 break-words font-mono text-xs text-ink-muted">{revokeTarget?.networks}</p></div>
      <p id="revoke-access-description" className="text-sm leading-relaxed text-ink-muted">Anything using this key will lose access. Your wallets and funds will not be deleted, and other access keys will keep working. Pending approvals and queued requests from this key will be denied; transactions already in progress may still complete.</p>
      {action.error && <p role="alert" className="mt-4 text-sm text-red-700">{action.error.message}</p>}
      <footer className="mt-6 flex justify-end gap-3 border-t border-beige-darker pt-5"><button type="button" className={`${dialogButton} border border-beige-darker hover:border-ink`} disabled={action.isPending} onClick={() => revokeDialog.current?.close()}>Cancel</button><button type="button" className={`${dialogButton} bg-red-700 text-white hover:bg-red-800`} disabled={action.isPending || !revokeTarget || revokeTarget.ownerId !== user?.id || revokeTarget.agentId !== agentId} onClick={() => { if (revokeTarget && revokeTarget.ownerId === user?.id && revokeTarget.agentId === agentId) action.mutate({ revokeId: revokeTarget.id }) }}>{action.isPending ? 'Revoking…' : 'Revoke access'}</button></footer>
    </dialog>
  </section>
}

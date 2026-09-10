'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentisClient } from '@agentis-hq/sdk'
import { useState } from 'react'
import Dropdown from './Dropdown'
import MultiSelect from './MultiSelect'

export default function WalletAccess({ agentId }: { agentId: string }) {
  const { ready, authenticated, getAccessToken, user } = usePrivy()
  const cache = useQueryClient()
  const [chainIds, setChainIds] = useState<string[]>([])
  const [scope, setScope] = useState('all')
  const [newKey, setNewKey] = useState<{ owner: string; token: string } | null>(null)
  const [message, setMessage] = useState('')
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
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ['access-keys', user?.id] }) })
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
        <div className="flex gap-4 font-mono text-xs"><button onClick={async () => { try { await navigator.clipboard.writeText(newKey.token); setMessage('Copied') } catch { setMessage('Could not copy. Select the key to copy manually.') } }}>copy key</button><button onClick={() => { setNewKey(null); setMessage('') }}>hide</button></div>
        <p role="status" className="text-xs text-ink-muted">{message}</p>
      </div>}
      <div className="divide-y divide-beige-darker">{keys.data?.filter(key => (key.agentId === agentId || wallets.data?.some(w => w.id === key.walletId && w.agentId === agentId)) && !key.revokedAt && (key.expiresAt === null || Date.parse(key.expiresAt) > keys.dataUpdatedAt)).map(key => {
        const wallet = wallets.data?.find(w => w.id === key.walletId)
        return <div key={key.id} className="flex items-center justify-between gap-4 py-3 text-xs"><div className="min-w-0"><p className="break-words font-mono">{key.chainIds ? key.chainIds.map(id => networks.data?.networks.find(n => n.chainId === id)?.name ?? id).join(', ') : key.agentId ? 'All networks' : networks.data?.networks.find(n => n.chainId === wallet?.chainId)?.name ?? 'Specific network'}</p><p className="mt-1 text-ink-muted">{key.expiresAt ? `Expires ${new Date(key.expiresAt).toLocaleString()}` : 'No expiry · valid until revoked'}</p></div><button className="font-mono text-ink-muted underline underline-offset-4 disabled:opacity-40" disabled={action.isPending} onClick={() => { setNewKey(null); action.mutate({ revokeId: key.id }) }}>revoke</button></div>
      })}</div>
      {error && <p role="alert" className="text-sm text-ink-muted">{error.message}</p>}
    </div>
  </section>
}

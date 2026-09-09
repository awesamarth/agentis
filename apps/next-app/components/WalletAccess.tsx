'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type WalletPolicy } from '@agentis-hq/sdk'
import { useState } from 'react'

export default function WalletAccess() {
  const { ready, authenticated, getAccessToken, user, login } = usePrivy()
  const [newToken, setNewToken] = useState<{ ownerId: string; value: string } | null>(null)
  const queries = useQueryClient()
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  const query = useQuery({ queryKey: ['wallets', user?.id], enabled: ready && authenticated, queryFn: () => client.wallets.list() })
  const agents = useQuery({ queryKey: ['agents', user?.id], enabled: ready && authenticated, queryFn: () => client.agents.list() })
  const action = useMutation({ mutationFn: async (input: { walletId: string; form: FormData; type: 'policy' | 'grant' | 'revoke' }) => {
    if (input.type === 'policy') return client.wallets.setPolicy(input.walletId, JSON.parse(String(input.form.get('policy'))))
    if (input.type === 'revoke') { await client.grants.revoke(String(input.form.get('grantId'))); setNewToken(null); return }
    const grant = await client.grants.create({ walletId: input.walletId, agentName: String(input.form.get('agentName')), expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
    setNewToken({ ownerId: user!.id, value: JSON.stringify(grant, null, 2) })
  }, onSuccess: () => queries.invalidateQueries({ queryKey: ['wallets'] }) })
  const link = useMutation({ mutationFn: (form: FormData) => {
    const policy: WalletPolicy = { mode: 'ask', maxPerOperationAtomic: '0', maxDailyAtomic: '0', maxLifetimeAtomic: '0', allowedRecipients: [] }
    return client.wallets.link({ providerWalletId: String(form.get('walletId')), chainId: 'eip155:84532', policy })
  }, onSuccess: () => queries.invalidateQueries({ queryKey: ['wallets'] }) })
  if (!ready) return <p>Loading…</p>
  if (!authenticated) return <button onClick={login}>Sign in to administer wallet access</button>
  return <section className="space-y-6">
    <h1 className="text-2xl">Wallet access</h1>
    <p>Manage your agents’ access and advanced wallet settings. Set each agent’s USD limits from the dashboard.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); link.mutate(new FormData(event.currentTarget)) }}>
      <label>Privy wallet ID (Base Sepolia) <input name="walletId" required className="border p-2" /></label><button disabled={link.isPending} className="border p-2">Link existing user-owned wallet</button>
    </form>
    {(query.error || action.error || link.error) && <p role="alert">{query.error?.message ?? action.error?.message ?? link.error?.message}</p>}
    {query.data?.map(wallet => <article id={wallet.agentId && query.data?.find(item => item.agentId === wallet.agentId)?.id === wallet.id ? `agent-${wallet.agentId}` : undefined} key={`${wallet.id}:${wallet.policyVersion}`} className="border p-4 space-y-4">
      <h2 className="font-serif text-xl font-bold">{agents.data?.find(agent => agent.id === wallet.agentId)?.name ?? 'Linked wallet'}</h2>
      <p className="break-all">{wallet.id} — {wallet.address} — {wallet.chainId}</p>
      <details><summary className="cursor-pointer text-sm">Advanced spending rules</summary><p className="my-3 text-xs text-ink-muted">Use budgetMode “atomic” to add per-token limits alongside this agent’s USD limits. Atomic amounts are the token’s smallest units. Saving requires new approvals for pending payments.</p><form onSubmit={event => { event.preventDefault(); action.mutate({ walletId: wallet.id, form: new FormData(event.currentTarget), type: 'policy' }) }}>
        <label className="block">Policy JSON <textarea name="policy" className="border p-2 w-full font-mono" rows={8} defaultValue={JSON.stringify(wallet.policy, null, 2)} /></label><button className="border p-2" disabled={action.isPending}>Save rules</button>
      </form></details>
      <form onSubmit={event => { event.preventDefault(); setNewToken(null); action.mutate({ walletId: wallet.id, form: new FormData(event.currentTarget), type: 'grant' }) }}>
        <label>Agent name <input className="border p-2" name="agentName" defaultValue={agents.data?.find(agent => agent.id === wallet.agentId)?.name} required maxLength={80} /></label><button className="border p-2" disabled={action.isPending}>Create 24-hour wallet grant</button>
      </form>
    </article>)}
    <form onSubmit={event => { event.preventDefault(); action.mutate({ walletId: '', form: new FormData(event.currentTarget), type: 'revoke' }) }}><label>Grant ID <input className="border p-2" name="grantId" required /></label><button className="border p-2" disabled={action.isPending}>Revoke grant</button></form>
    {newToken?.ownerId === user?.id && newToken && <div><p>Shown once. Store in your agent deployment’s secrets, not prompts or chat logs.</p><pre className="overflow-auto">{newToken.value}</pre><button onClick={() => setNewToken(null)}>Hide credential</button></div>}
  </section>
}

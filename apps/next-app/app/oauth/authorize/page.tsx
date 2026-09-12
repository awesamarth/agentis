'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AgentisClient } from '@agentis-hq/sdk'
import Navbar from '@/components/Navbar'
import Onboarding from '@/components/Onboarding'

const button = 'bg-black px-5 py-3 font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40'
export default function OAuthPage() {
  return <Suspense fallback={<p className="p-8">Loading MCP connection…</p>}><Connection /></Suspense>
}
function Connection() {
  const params = useSearchParams()
  const { ready, authenticated, user, login, getAccessToken } = usePrivy()
  return <><Navbar showCrumb="MCP connection" /><main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
    <header><h1 className="font-serif text-3xl font-bold">Connect your MCP client.</h1><p className="mt-3 text-sm text-ink-muted">Choose the agents and network wallets this client may use. Your account login and owner permissions stay in the browser.</p></header>
    {!ready || (authenticated && !user) ? <p role="status">Loading…</p> : !authenticated ? <button className={button} onClick={login}>Sign in to choose wallets</button> : <Selection key={`${user?.id}:${params.get('request')}`} requestId={params.get('request') ?? ''} ownerId={user!.id} getAccessToken={getAccessToken} />}
  </main></>
}
function Selection({ requestId, ownerId, getAccessToken }: { requestId: string; ownerId: string; getAccessToken: () => Promise<string | null> }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [confirmed, setConfirmed] = useState(false)
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw Error('Sign in again'); return token } })
  const valid = /^[0-9a-f-]{36}$/i.test(requestId)
  const session = useQuery({ queryKey: ['oauth-request', ownerId, requestId], queryFn: () => client.oauth.request(requestId), enabled: valid, retry: false })
  const agents = useQuery({ queryKey: ['agents', ownerId], queryFn: () => client.agents.list(), enabled: valid })
  const wallets = useQuery({ queryKey: ['wallets', ownerId], queryFn: () => client.wallets.list(), enabled: valid })
  const networks = useQuery({ queryKey: ['onboarding', ownerId], queryFn: () => client.onboarding.get(), enabled: valid })
  const choices = Object.entries(selected).filter(([, chains]) => chains.length).map(([agentId, chainIds]) => ({ agentId, chainIds }))
  const complete = useMutation({ mutationFn: (approve: boolean) => client.oauth.complete(requestId, approve ? { approve: true, confirm: true, selections: choices } : { approve: false }), onSuccess: result => { window.location.assign(result.redirectUrl) } })
  if (!valid) return <p>Start by connecting to the Agentis remote MCP URL in your MCP client.</p>
  if (complete.isSuccess) return <p role="status">Returning to your MCP client…</p>
  if (session.data?.completed) return <p>This connection request was already completed. Return to your MCP client or start a new connection.</p>
  const error = session.error ?? agents.error ?? wallets.error ?? networks.error
  if (error) return <p role="alert">{error.message}</p>
  if (!session.data || !agents.data || !wallets.data || !networks.data) return <p role="status">Loading your agents…</p>
  return <>
    <div className="border border-beige-darker bg-white p-5"><p className="font-mono text-xs uppercase text-ink-muted">Client requesting access</p><h2 className="mt-3 break-words font-serif text-2xl font-bold">{session.data.clientName}</h2><p className="mt-2 break-all text-sm">Return address: {session.data.redirectUri}</p><p className="mt-3 text-sm text-ink-muted">Client names are self-reported. Only continue if you started this connection in a client you trust. This request expires at {new Date(session.data.expiresAt).toLocaleTimeString()}.</p></div>
    <Onboarding createOnly />
    {!agents.data.length && <p className="text-sm text-ink-muted">Create an agent above, then select its wallets here.</p>}
    <fieldset disabled={complete.isPending} className="space-y-4"><legend className="mb-3 font-mono text-xs uppercase tracking-widest">Wallet access</legend>
      {agents.data.map(agent => {
        const available = wallets.data!.filter(wallet => wallet.agentId === agent.id && wallet.enabled)
        const chosen = selected[agent.id] ?? []
        return <div key={agent.id} className="border border-beige-darker bg-white p-5">
          <label className="flex items-center gap-3"><input type="checkbox" className="accent-black" disabled={!available.length} checked={available.length > 0 && available.every(wallet => chosen.includes(wallet.chainId))} onChange={event => setSelected({ ...selected, [agent.id]: event.target.checked ? available.map(wallet => wallet.chainId) : [] })} /><span className="flex-1 font-serif text-xl font-bold">{agent.name}</span><span className="font-mono text-[10px] uppercase text-ink-muted">{agent.mode === 'ask' ? 'Owner approval required' : agent.mode === 'automatic' ? 'Automatic within limits' : 'Paused'}</span></label>
          {!available.length && <p className="mt-3 text-sm text-ink-muted">No enabled network wallets.</p>}
          <div className="mt-4 space-y-3">{available.map(wallet => <label key={wallet.id} className="flex items-start gap-3"><input type="checkbox" className="mt-1 accent-black" checked={chosen.includes(wallet.chainId)} onChange={event => setSelected({ ...selected, [agent.id]: event.target.checked ? [...chosen, wallet.chainId] : chosen.filter(chain => chain !== wallet.chainId) })} /><span className="min-w-0"><span className="text-sm">{networks.data!.networks.find(network => network.chainId === wallet.chainId)?.name ?? wallet.chainId}</span><span className="mt-1 block break-all font-mono text-[11px] text-ink-muted">{wallet.address}</span></span></label>)}</div>
        </div>
      })}
    </fieldset>
    <p className="text-sm text-ink-muted">Allows reading balances, policies and payment history, and requesting transfers or x402/MPP payments. Existing budgets and owner approvals stay in force. No policy changes, payment approval, key export or agent administration. Newly enabled networks need new consent. Revoke MCP access from each agent’s API access panel.</p>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-black" checked={confirmed} disabled={complete.isPending} onChange={event => setConfirmed(event.target.checked)} />I started this connection and trust this client with the selected wallets.</label>
    {complete.error && <p role="alert" className="text-sm">{complete.error.message}</p>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={!confirmed || !choices.length || complete.isPending} onClick={() => complete.mutate(true)}>{complete.isPending ? 'Connecting…' : `Connect ${choices.length || ''} agent${choices.length === 1 ? '' : 's'}`}</button><button className="border border-beige-darker px-5 py-3 font-mono text-xs uppercase tracking-widest disabled:opacity-40" disabled={complete.isPending} onClick={() => complete.mutate(false)}>Cancel</button></div>
  </>
}

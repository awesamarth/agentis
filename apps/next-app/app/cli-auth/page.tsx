'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AgentisClient } from '@agentis-hq/sdk'
import Navbar from '@/components/Navbar'
import Onboarding from '@/components/Onboarding'

const button = 'bg-black px-5 py-3 font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40'
export default function CliAuth() {
  return <Suspense fallback={<p className="p-8">Loading CLI login…</p>}><Connection /></Suspense>
}
function Connection() {
  const params = useSearchParams()
  const { ready, authenticated, user, login, getAccessToken } = usePrivy()
  return <><Navbar showCrumb="CLI login" /><main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
    <header><h1 className="font-serif text-3xl font-bold">Connect your CLI.</h1><p className="mt-3 text-sm text-ink-muted">Choose the agents and network wallets this CLI may use. Your account login and owner permissions stay in the browser.</p></header>
    {!ready || (authenticated && !user) ? <p role="status">Loading…</p> : !authenticated ? <button className={button} onClick={login}>Sign in to choose wallets</button> : <Selection key={`${user?.id}:${params.get('request')}`} requestId={params.get('request') ?? ''} ownerId={user!.id} getAccessToken={getAccessToken} />}
  </main></>
}
function Selection({ requestId, ownerId, getAccessToken }: { requestId: string; ownerId: string; getAccessToken: () => Promise<string | null> }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [confirmed, setConfirmed] = useState(false)
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw Error('Sign in again'); return token } })
  const valid = /^[0-9a-f-]{36}$/i.test(requestId)
  const session = useQuery({ queryKey: ['cli-login', ownerId, requestId], queryFn: () => client.cliLogin.get(requestId), enabled: valid, retry: false })
  const agents = useQuery({ queryKey: ['agents', ownerId], queryFn: () => client.agents.list(), enabled: valid })
  const wallets = useQuery({ queryKey: ['wallets', ownerId], queryFn: () => client.wallets.list(), enabled: valid })
  const networks = useQuery({ queryKey: ['onboarding', ownerId], queryFn: () => client.onboarding.get(), enabled: valid })
  const choices = Object.entries(selected).filter(([, chains]) => chains.length).map(([agentId, chainIds]) => ({ agentId, chainIds }))
  const approve = useMutation({ mutationFn: () => client.cliLogin.approve(requestId, choices, session.data!.code) })
  if (!valid) return <p>Start with <code>agentis login</code> in your terminal, then open the link it gives you.</p>
  if (approve.isSuccess || session.data?.approved) return <div role="status" className="border border-beige-darker bg-white p-6"><h2 className="font-serif text-2xl font-bold">CLI access approved.</h2><p className="mt-3 text-sm">Return to your terminal to finish connecting. You can close this page.</p><p className="mt-2 text-sm text-ink-muted">Revoke individual CLI keys from each agent’s API access panel in the dashboard.</p></div>
  const error = session.error ?? agents.error ?? wallets.error ?? networks.error
  if (error) return <p role="alert">{error.message}</p>
  if (!session.data || !agents.data || !wallets.data || !networks.data) return <p role="status">Loading your agents…</p>
  return <>
    <div className="border border-beige-darker bg-white p-5"><p className="font-mono text-xs uppercase text-ink-muted">Match this code with your terminal</p><p className="my-3 font-mono text-2xl tracking-widest">{session.data.code}</p><p className="text-sm text-ink-muted">Only continue if you started this login. Never approve a login link sent by someone else. This request expires at {new Date(session.data.expiresAt).toLocaleTimeString()}.</p></div>
    <Onboarding createOnly />
    {!agents.data.length && <p className="text-sm text-ink-muted">Create an agent above, then select its wallets here.</p>}
    <fieldset disabled={approve.isPending} className="space-y-4">
      <legend className="mb-3 font-mono text-xs uppercase tracking-widest">Wallet access</legend>
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
    <p className="text-sm text-ink-muted">Only selected networks are included; newly enabled networks need new authorization. Existing budgets and payment approvals stay in force. CLI keys remain valid until revoked and cannot approve payments, change rules, create hosted agents or export keys.</p>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-black" checked={confirmed} disabled={approve.isPending} onChange={event => setConfirmed(event.target.checked)} />I started this login and the code matches my terminal.</label>
    {approve.error && <p role="alert" className="text-sm">{approve.error.message}</p>}
    <button className={button} disabled={!confirmed || !choices.length || approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? 'Connecting…' : `Connect ${choices.length || ''} agent${choices.length === 1 ? '' : 's'}`}</button>
  </>
}

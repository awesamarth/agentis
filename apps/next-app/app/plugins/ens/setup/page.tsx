'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery } from '@tanstack/react-query'
import { AgentisClient } from '@agentis-hq/sdk'
import IdentityControls from '@/components/IdentityControls'
function Setup() {
  const search = useSearchParams(), { ready, authenticated, user, login, getAccessToken } = usePrivy()
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw Error('Sign in again'); return token } })
  const agents = useQuery({ queryKey: ['agents', user?.id], enabled: ready && authenticated, queryFn: () => client.agents.list() })
  const agent = agents.data?.find(agent => agent.id === search.get('agent'))
  if (!ready) return <p>Loading…</p>
  if (!authenticated) return <button className="bg-black px-4 py-2 text-beige" onClick={login}>Sign in to review identity setup</button>
  if (agents.error) return <p role="alert">{agents.error.message}</p>
  if (agents.isPending) return <p>Loading agents…</p>
  if (!agent) return <p>Agent not found in your account.</p>
  return <><h1 className="mb-5 font-serif text-3xl font-bold">Identity for {agent.name}</h1><p className="mb-5 text-base leading-relaxed text-ink-muted">Review the requested name before continuing. No namespace permissions change until you sign the corresponding owner-wallet transactions.</p><IdentityControls agent={agent} initialParent={search.get('parent') ?? ''} initialLabel={search.get('label') ?? ''} initialOperation={search.get('operation') ?? ''} /></>
}
export default function Page() { return <main className="mx-auto max-w-2xl px-5 py-12"><Suspense fallback={<p>Loading…</p>}><Setup /></Suspense></main> }

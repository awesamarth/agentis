'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery } from '@tanstack/react-query'
import { useAgentisClient } from '@/lib/agentis'
import Navbar from '@/components/Navbar'
import GuestWallets from '@/components/GuestWallets'
import WalletAccess from '@/components/WalletAccess'
import Onboarding, { WalletAddress } from '@/components/Onboarding'
import AgentDangerZone from '@/components/AgentDangerZone'
import AgentBalance from '@/components/AgentBalance'
import Operations from '@/components/Operations'
import AgentPlugins from '@/components/AgentPlugins'

export default function AgentPage() {
  const { id } = useParams<{ id: string }>()
  const { ready, authenticated } = usePrivy()
  return <><Navbar showCrumb="agent" /><main className="mx-auto max-w-4xl space-y-8 px-6 py-12 sm:px-8">
    <Link href="/dashboard" className="font-mono text-xs text-ink-muted hover:text-ink">← dashboard</Link>
    {!ready ? <p role="status">Loading…</p> : authenticated ? <HostedAgent key={id} id={id} /> : <GuestWallets selectedId={id} />}
  </main></>
}

function HostedAgent({ id }: { id: string }) {
  const { user } = usePrivy()
  const client = useAgentisClient('Sign in first')
  const agents = useQuery({ queryKey: ['agents', user?.id], queryFn: () => client.agents.list() })
  const wallets = useQuery({ queryKey: ['wallets', user?.id], queryFn: () => client.wallets.list() })
  const networks = useQuery({ queryKey: ['onboarding', user?.id], queryFn: () => client.onboarding.get() })
  const error = agents.error ?? wallets.error ?? networks.error
  if (error) return <p role="alert" className="text-sm text-ink-muted">{error.message}</p>
  if (agents.isPending || wallets.isPending || networks.isPending) return <p role="status" className="text-sm text-ink-muted">Loading agent…</p>
  const agent = agents.data?.find(a => a.id === id)
  // Browser-local wallets remain accessible, including after signing in.
  if (!agent) return <GuestWallets selectedId={id} />
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="break-words font-serif text-3xl font-bold">{agent.name}</h1><p className="mt-2 font-mono text-xs text-ink-muted">{agent.mode === 'paused' ? 'Paused' : agent.mode === 'automatic' ? 'Auto-approve within limits' : 'Approval required'}</p></div><Onboarding agentId={id} /></header>
    <AgentBalance agentId={id} breakdown />
    <section><h2 className="mb-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">Wallets</h2><div className="grid gap-4 sm:grid-cols-2">{wallets.data?.filter(w => w.agentId === id).map(wallet => <div key={wallet.id} className="min-w-0 border border-beige-darker bg-white p-5"><p className="mb-3 font-mono text-xs text-ink-muted">{networks.data?.networks.find(n => n.chainId === wallet.chainId)?.name}{!wallet.enabled && ' · Disabled'}</p><WalletAddress address={wallet.address} /></div>)}</div></section>
    <AgentPlugins agent={agent} />
    <Operations agentId={id} />
    <WalletAccess key={id} agentId={id} />
    <AgentDangerZone agent={agent} wallets={wallets.data?.filter(wallet => wallet.agentId === id) ?? []} networks={networks.data?.networks ?? []} />
  </>
}

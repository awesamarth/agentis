'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useQuery } from '@tanstack/react-query'
import { useAgentisClient } from '@/lib/agentis'
import { formatUnits } from 'viem'

function dollars(micros: string | null) {
  if (micros === null) return 'Unavailable'
  const value = BigInt(micros)
  if (value > 0n && value < 10_000n) return '<$0.01'
  const cents = value / 10_000n
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}

export default function AgentBalance({ agentId, breakdown = false }: { agentId: string; breakdown?: boolean }) {
  const { user, authenticated } = usePrivy()
  const client = useAgentisClient('Sign in first')
  const query = useQuery({
    queryKey: ['agent-balances', user?.id], enabled: authenticated && !!user?.id,
    staleTime: 30_000, refetchInterval: 60_000, retry: false,
    queryFn: () => client.agents.balances(),
  })
  const balance = query.isError ? undefined : query.data?.[agentId]
  const total = <>
    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">Balance in USD</span>
    <span className="mt-1 block font-serif text-3xl">{query.isPending ? 'Loading…' : balance ? dollars(balance.usdMicros) : 'Unavailable'}{balance && !balance.complete && balance.usdMicros !== null && <span className="ml-2 font-sans text-xs text-ink-muted">Partial</span>}</span>
  </>
  if (!breakdown) return <div className="my-5 border-y border-beige-darker py-4">{total}</div>
  return <details className="relative z-10 my-5 border-y border-beige-darker py-4">
    <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">{total}</summary>
    <div className="mt-4 space-y-4 text-sm">
      <p className="text-xs text-ink-muted">Supported tokens across enabled testnets only.</p>
      {balance?.networks.map(network => <div key={network.chainId}>
        <div className="flex flex-wrap justify-between gap-2 font-medium"><span>{network.name}</span><span>{dollars(network.usdMicros)}{!network.complete && network.usdMicros !== null ? ' · Partial' : ''}</span></div>
        {network.tokens.map(token => <div key={token.asset} className="mt-1 flex flex-wrap justify-between gap-2 font-mono text-xs text-ink-muted"><span>{token.amountAtomic === null ? 'Unavailable' : formatUnits(BigInt(token.amountAtomic), token.decimals)} {token.symbol}</span><span>{dollars(token.usdMicros)}</span></div>)}
      </div>)}
      {balance && !balance.networks.length && <p>No enabled wallets.</p>}
      {(!balance && !query.isPending || balance && !balance.complete) && <p role="status" className="text-xs text-ink-muted">Some balances or prices could not be loaded. Missing values are not counted as zero.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"><span>{query.isFetching ? 'Refreshing…' : balance ? `Checked ${new Date(balance.checkedAt).toLocaleTimeString()}` : ''}</span><button type="button" className="underline underline-offset-4 disabled:opacity-40" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh</button></div>
    </div>
  </details>
}

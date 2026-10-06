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

export default function AgentBalance({ agentId, breakdown = false, testnet = false }: { agentId: string; breakdown?: boolean; testnet?: boolean }) {
  const { user, authenticated } = usePrivy()
  const client = useAgentisClient('Sign in first')
  const query = useQuery({
    queryKey: ['agent-balances', user?.id], enabled: authenticated && !!user?.id,
    staleTime: 120_000, refetchInterval: 120_000, retry: false,
    queryFn: () => client.agents.balances(),
  })
  const balance = query.data?.[agentId]
  const selected = balance?.networks.filter(network => network.testnet === testnet) ?? []
  const classified = !!balance
  const known = selected.filter(network => network.usdMicros !== null)
  const complete = classified && selected.every(network => network.complete)
  const usdMicros = !classified ? null : !selected.length ? '0' : known.length ? known.reduce((sum, network) => sum + BigInt(network.usdMicros!), 0n).toString() : null
  if (testnet) {
    return <section className="space-y-4">
      <h2 className="font-serif text-2xl font-bold">Testnet balances</h2>
      {query.isPending && <p role="status" className="text-sm text-ink-muted">Loading testnet balances…</p>}
      {!classified && !query.isPending && <p role="status" className="text-sm text-ink-muted">Testnet balances unavailable.</p>}
      <div className="grid gap-4 sm:grid-cols-2">{selected.map(network => <div key={network.chainId} className="border border-beige-darker bg-[#faf7f1] p-4"><h3 className="font-medium">{network.name} <span className="ml-2 font-mono text-[10px] uppercase text-ink-muted">Testnet</span></h3>{network.tokens.map(token => <p key={token.asset} className="mt-2 font-mono text-xs">{token.amountAtomic === null ? 'Unavailable' : formatUnits(BigInt(token.amountAtomic), token.decimals)} {token.symbol}</p>)}</div>)}</div>
      {query.isError && balance && <p role="status" className="text-xs text-ink-muted">Could not refresh. Showing last fetched balances.</p>}
      {balance && <p className="text-xs text-ink-muted">Checked {new Date(balance.checkedAt).toLocaleTimeString()} · Refreshes every 2 minutes.</p>}
    </section>
  }
  const total = <>
    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">Balance in USD</span>
    <span className="mt-1 block font-serif text-3xl">{query.isPending ? 'Loading…' : dollars(usdMicros)}{classified && !complete && usdMicros !== null && <span className="ml-2 font-sans text-xs text-ink-muted">Partial</span>}</span>
  </>
  if (!breakdown) return <div className="my-5 border-y border-beige-darker py-4">{total}</div>
  return <details className="relative z-10 my-5 border-y border-beige-darker py-4">
    <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">{total}</summary>
    <div className="mt-4 space-y-4 text-sm">
      {selected.map(network => <div key={network.chainId}>
        <div className="flex flex-wrap justify-between gap-2 font-medium"><span>{network.name}</span><span>{dollars(network.usdMicros)}{!network.complete && network.usdMicros !== null ? ' · Partial' : ''}</span></div>
        {network.tokens.map(token => <div key={token.asset} className="mt-1 flex flex-wrap justify-between gap-2 font-mono text-xs text-ink-muted"><span>{token.amountAtomic === null ? 'Unavailable' : formatUnits(BigInt(token.amountAtomic), token.decimals)} {token.symbol}</span><span>{dollars(token.usdMicros)}</span></div>)}
      </div>)}
      {classified && !selected.length && <p>No enabled mainnet wallets.</p>}
      {(!classified && !query.isPending || classified && !complete) && <p role="status" className="text-xs text-ink-muted">Some balances or prices could not be loaded. Missing values are not counted as zero.</p>}
      {query.isError && balance && <p role="status" className="text-xs text-ink-muted">Could not refresh. Showing last fetched balances.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"><span>{query.isFetching ? 'Refreshing…' : balance ? `Checked ${new Date(balance.checkedAt).toLocaleTimeString()}` : ''}</span><button type="button" className="underline underline-offset-4 disabled:opacity-40" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh</button></div>
    </div>
  </details>
}

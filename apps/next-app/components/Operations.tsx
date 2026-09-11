'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type Operation } from '@agentis-hq/sdk'
import { formatUnits } from 'viem'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'

export default function Operations({ id }: { id?: string }) {
  const { ready, authenticated, getAccessToken, user, login } = usePrivy()
  const queries = useQueryClient()
  const client = new AgentisClient({
    baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001',
    token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token },
  })
  const networks = useQuery({ queryKey: ['onboarding', user?.id], enabled: ready && authenticated, queryFn: () => client.onboarding.get() })
  const key = ['operations', user?.id, id]
  const query = useQuery({ queryKey: key, enabled: ready && authenticated, queryFn: async () => id ? [await client.operations.get(id)] : client.operations.list(), refetchInterval: 5000 })
  const decision = useMutation({ mutationFn: async ({ operation, approve }: { operation: Operation; approve: boolean }) => {
    if (!approve) return client.operations.reject(operation.id, operation.operationHash)
    return client.operations.approve(operation.id, operation.operationHash)
  }, onSuccess: () => queries.invalidateQueries({ queryKey: ['operations'] }) })
  if (!ready) return <p role="status">Loading your payments…</p>
  if (!authenticated) return <button className="border p-3" onClick={login}>Sign in to review payments</button>
  return <section className="space-y-4">
    <div className="border-b border-beige-darker pb-4"><h2 className="font-serif text-2xl font-bold">{id ? 'Review payment' : 'Payment activity'}</h2><p className="mt-2 text-sm text-ink-muted">{id ? 'Check the amount and recipient before you approve.' : 'Your requests, approvals and receipts in one place.'}</p></div>
    {query.isPending && <p>Loading…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {decision.error && <p role="alert">{decision.error.message}</p>}
    {query.data?.length === 0 && <div className="border border-dashed border-beige-darker p-10 text-center"><h3 className="font-serif text-xl font-bold">Your first payment starts here.</h3><p className="mt-2 text-sm text-ink-muted">Create a payment above. Requests from your agents will appear here too.</p></div>}
    {query.data?.map(operation => {
      const network = networks.data?.networks.find(network => network.chainId === operation.chainId)
      const asset = network?.assets.find(asset => operation.asset.startsWith('erc20:') ? asset.id.toLowerCase() === operation.asset.toLowerCase() : asset.id === operation.asset)
      const status = { pending_approval: 'Needs approval', queued: 'Approved', submitting: 'Sending', submitted: 'Confirming', unknown: 'Checking payment', confirmed: 'Completed', failed: 'Failed', denied: 'Not allowed', expired: 'Expired', rejected: 'Declined' }[operation.status]
      const approving = decision.isPending && decision.variables?.approve && decision.variables.operation.id === operation.id && operation.status === 'pending_approval'
      const processing = ['queued', 'submitting', 'submitted'].includes(operation.status)
      const explorer = network && operation.transactionHash ? `${network.explorer}/tx/${encodeURIComponent(operation.transactionHash)}${network.key === 'solana' ? '?cluster=devnet' : ''}` : null
      return <article className="border border-beige-darker bg-[#faf7f1] px-4 py-3" key={operation.id}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="break-all font-serif text-lg font-bold">{asset ? `${formatUnits(BigInt(operation.amountAtomic), asset.decimals)} ${asset.symbol}` : `${operation.amountAtomic} atomic units`}</h3><p className="break-all font-mono text-[10px] uppercase tracking-widest text-ink-muted">{network?.name ?? operation.chainId}</p></div><span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${operation.status === 'pending_approval' ? 'border-ink bg-beige-dark' : 'border-beige-darker text-ink-muted'}`}>{status}</span></div>
        {operation.reason && <p className="mt-[7px] break-words text-xs">{operation.reason}</p>}
        {operation.payment && <p className="mt-[7px] break-all font-mono text-xs">x402 · GET <a href={operation.payment.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{operation.payment.url}</a></p>}
        {operation.mpp && <p className="mt-[7px] break-all font-mono text-xs">MPP · GET <a href={operation.mpp.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{operation.mpp.url}</a></p>}
        {operation.httpResponse && <p className="mt-[7px] text-xs text-ink-muted">API response: HTTP {operation.httpResponse.status}. Payment settlement is tracked separately.</p>}
        <dl className="mt-[9px] flex flex-wrap gap-x-5 gap-y-[7px] text-xs"><div className="flex w-full min-w-0 items-baseline gap-2"><dt className="shrink-0 text-ink-muted">Recipient</dt><dd className="min-w-0 break-all font-mono">{operation.to}</dd></div><div className="flex flex-wrap gap-x-2"><dt className="text-ink-muted">Maximum network fee</dt><dd className="break-all">{network ? `${formatUnits(BigInt(operation.maxFeeAtomic), network.decimals)} ${network.currency}` : `${operation.maxFeeAtomic} atomic units`}</dd></div>{operation.usdReservedMicros != null && <div className="flex flex-wrap gap-x-2"><dt className="text-ink-muted">{operation.usdSettledMicros != null ? 'Budget charged' : 'Maximum USD cost · including fees'}</dt><dd className="break-all">${formatUnits(BigInt(operation.usdSettledMicros ?? operation.usdReservedMicros), 6)}</dd></div>}</dl>
        {operation.status === 'pending_approval' && <p className="mt-[9px] text-xs text-ink-muted">Approval expires {new Date(operation.expiresAt).toLocaleString()}.</p>}
        {(approving || processing) && <p role="status" className="mt-[9px] flex items-center gap-2 text-xs text-ink"><LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />{approving ? 'Approving payment…' : 'Processing transaction…'}</p>}
        {operation.status === 'unknown' && <p role="status" className="mt-[9px] border-l-2 border-accent pl-2 text-xs">We’re checking whether this payment went through. Don’t send it again.</p>}
        {operation.error && <p className="mt-[9px] break-words text-xs">{operation.error}</p>}
        {operation.status === 'pending_approval' && <div className="mt-3 flex flex-wrap gap-2"><button className="bg-black px-3 py-2 font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40" disabled={decision.isPending || !asset} onClick={() => decision.mutate({ operation, approve: true })}>{decision.isPending ? 'Working…' : 'Approve payment'}</button><button className="border border-beige-darker px-3 py-2 font-mono text-xs uppercase tracking-widest disabled:opacity-40" disabled={decision.isPending} onClick={() => decision.mutate({ operation, approve: false })}>Decline</button></div>}
        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-2">
          {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">View transaction <ArrowUpRight size={12} aria-hidden="true" /></a>}
          <details className="min-w-0 flex-1 text-xs text-ink-muted"><summary className="cursor-pointer whitespace-nowrap">Technical details</summary><p className="mt-2 break-all font-mono">Payment ID: {operation.id}<br />Approval hash: {operation.operationHash}<br />Asset: {operation.asset}</p>{operation.receipt && <pre className="mt-2 overflow-auto">{JSON.stringify(operation.receipt, null, 2)}</pre>}</details>
        </div>
      </article>
    })}
  </section>
}

'use client'
import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type Operation } from '@agentis-hq/sdk'
import { formatUnits } from 'viem'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'

export default function Operations({ id, agentId }: { id?: string; agentId?: string }) {
  const { ready, authenticated, getAccessToken, user, login } = usePrivy()
  const queries = useQueryClient()
  const [visibleCount, setVisibleCount] = useState(10)
  const client = new AgentisClient({
    baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001',
    token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token },
  })
  const networks = useQuery({ queryKey: ['onboarding', user?.id], enabled: ready && authenticated, queryFn: () => client.onboarding.get() })
  const key = ['operations', user?.id, id, agentId]
  const query = useQuery({ queryKey: key, enabled: ready && authenticated, queryFn: async () => id ? [await client.operations.get(id)] : client.operations.list(agentId), refetchInterval: 5000 })
  const decision = useMutation({ mutationFn: async ({ operation, approve }: { operation: Operation; approve: boolean }) => {
    if (!approve) return client.operations.reject(operation.id, operation.operationHash)
    return client.operations.approve(operation.id, operation.operationHash)
  }, onSuccess: () => queries.invalidateQueries({ queryKey: ['operations'] }) })
  if (!ready) return <p role="status">Loading your payments…</p>
  if (!authenticated) return <button className="border p-3" onClick={login}>Sign in to review payments</button>
  const layout = (compact: string, review: string) => id ? review : compact
  return <section className="space-y-4">
    <div className="border-b border-beige-darker pb-4"><h2 className="font-serif text-2xl font-bold">{id ? 'Review payment' : agentId ? 'Payment activity' : 'All payments'}</h2><p className="mt-2 text-sm text-ink-muted">{id ? 'Check the amount and recipient before you approve.' : agentId ? 'Requests, approvals and receipts for this agent.' : 'Requests, approvals and receipts across all your agents.'}</p></div>
    {query.isPending && <p>Loading…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {decision.error && <p role="alert">{decision.error.message}</p>}
    {query.data?.length === 0 && <div className="border border-dashed border-beige-darker p-10 text-center"><h3 className="font-serif text-xl font-bold">Your first payment starts here.</h3><p className="mt-2 text-sm text-ink-muted">{agentId ? 'Payments requested by this agent will appear here.' : 'Create a payment above. Requests from your agents will appear here too.'}</p></div>}
    {query.data?.slice(0, id ? 1 : visibleCount).map(operation => {
      const network = networks.data?.networks.find(network => network.chainId === operation.chainId)
      const asset = network?.assets.find(asset => operation.asset.startsWith('erc20:') ? asset.id.toLowerCase() === operation.asset.toLowerCase() : asset.id === operation.asset)
      const status = { pending_approval: 'Needs approval', queued: 'Approved', submitting: 'Sending', submitted: 'Confirming', unknown: 'Checking payment', confirmed: 'Completed', failed: 'Failed', denied: 'Not allowed', expired: 'Expired', rejected: 'Declined' }[operation.status]
      const approving = decision.isPending && decision.variables?.approve && decision.variables.operation.id === operation.id && operation.status === 'pending_approval'
      const processing = ['queued', 'submitting', 'submitted'].includes(operation.status)
      const explorer = network && operation.transactionHash ? `${network.explorer}/tx/${encodeURIComponent(operation.transactionHash)}${network.key === 'solana' ? '?cluster=devnet' : ''}` : null
      return <article className={`border border-beige-darker bg-[#faf7f1] ${layout('px-4 py-3', 'p-5 sm:p-7')}`} key={operation.id}>
        <div className={layout('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', 'flex flex-wrap items-start justify-between gap-4')}><div className={layout('flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1', 'flex min-w-0 flex-col')}><h3 className={`break-all font-serif font-bold ${layout('text-lg', 'order-2 mt-2 text-3xl')}`}>{asset ? `${formatUnits(BigInt(operation.amountAtomic), asset.decimals)} ${asset.symbol}` : `${operation.amountAtomic} atomic units`}</h3><p className="break-all font-mono text-[10px] uppercase tracking-widest text-ink-muted">{network?.name ?? operation.chainId}</p></div><span className={`border ${layout('px-2 py-1', 'px-3 py-2')} font-mono text-[10px] uppercase tracking-widest ${operation.status === 'pending_approval' ? 'border-ink bg-beige-dark' : operation.status === 'rejected' ? 'border-red-300 bg-red-50/40 text-red-700' : 'border-beige-darker text-ink-muted'}`}>{status}</span></div>
        {operation.ens && <p className="mt-3 text-sm"><strong>{operation.ens.name}</strong> · resolved on Ethereum Sepolia. Approval is bound to the recipient address below.</p>}
        {operation.identity && <div className="mt-3 space-y-2 text-sm"><p className="font-medium">{operation.identity.name} · {operation.identity.kind === 'record' ? `Update ${operation.identity.key}` : `ERC-8004 ${operation.identity.kind}`}</p>{operation.identity.kind === 'record' && <p className="break-all">{operation.identity.value || '(clear record)'}</p>}<p className="text-xs text-ink-muted">Identity transaction on Ethereum Sepolia. No token amount is transferred; the agent pays gas under its existing limits.</p></div>}
        {operation.swap && <div className="mt-3 space-y-1 text-sm"><p className="font-medium">{operation.action === 'uniswap_approval' ? 'Uniswap · token allowance (fees only, not a transfer)' : 'Uniswap · maximum swap input shown above'}</p><p className="text-xs text-ink-muted">{operation.action === 'uniswap_approval' ? 'Exact-amount allowance for the vetted Base Sepolia SwapRouter02. The swap is a separate operation.' : `Minimum received: ${formatUnits(BigInt(operation.swap.minimumOutputAtomic), operation.swap.tokenOut === 'ETH' ? 18 : 6)} ${operation.swap.tokenOut}. Output returns to this agent’s wallet.`}</p>{operation.receipt?.swap && <p className="text-xs">Received: {formatUnits(BigInt(operation.receipt.swap.outputAtomic), operation.receipt.swap.tokenOut === 'ETH' ? 18 : 6)} {operation.receipt.swap.tokenOut}</p>}</div>}
        {operation.reason && <p className={layout('mt-[7px] break-words text-xs', 'mt-4 break-words text-sm')}>{operation.reason}</p>}
        {operation.payment && <p className={`${layout('mt-[7px]', 'mt-3')} break-all font-mono text-xs`}>x402 · GET <a href={operation.payment.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{operation.payment.url}</a></p>}
        {operation.mpp && <p className={`${layout('mt-[7px]', 'mt-3')} break-all font-mono text-xs`}>MPP · GET <a href={operation.mpp.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{operation.mpp.url}</a></p>}
        {operation.httpResponse && <p className={layout('mt-[7px] text-xs text-ink-muted', 'mt-3 text-sm')}>API response: HTTP {operation.httpResponse.status}. Payment settlement is tracked separately.</p>}
        <dl className={layout('mt-[9px] flex flex-wrap gap-x-5 gap-y-[7px] text-xs', 'mt-5 grid gap-4 border-t border-beige-darker pt-5 text-sm sm:grid-cols-2')}><div className={layout('flex w-full min-w-0 items-baseline gap-2', 'sm:col-span-2')}><dt className={layout('shrink-0 text-ink-muted', 'mb-1 text-xs text-ink-muted')}>Recipient</dt><dd className={layout('min-w-0 break-all font-mono', 'break-all font-mono text-xs leading-relaxed')}>{operation.to}</dd></div><div className={layout('flex flex-wrap gap-x-2', '')}><dt className={layout('text-ink-muted', 'mb-1 text-xs text-ink-muted')}>Maximum network fee</dt><dd className="break-all">{network ? `${formatUnits(BigInt(operation.maxFeeAtomic), network.decimals)} ${network.currency}` : `${operation.maxFeeAtomic} atomic units`}</dd></div>{operation.usdReservedMicros != null && <div className={layout('flex flex-wrap gap-x-2', '')}><dt className={layout('text-ink-muted', 'mb-1 text-xs text-ink-muted')}>{operation.usdSettledMicros != null ? 'Budget charged' : 'Maximum USD cost · including fees'}</dt><dd className="break-all">${formatUnits(BigInt(operation.usdSettledMicros ?? operation.usdReservedMicros), 6)}</dd></div>}</dl>
        {operation.status === 'pending_approval' && <p className={`${layout('mt-[9px]', 'mt-4')} text-xs text-ink-muted`}>Approval expires {new Date(operation.expiresAt).toLocaleString()}.</p>}
        {(approving || processing) && <p role="status" className={`${layout('mt-[9px] text-xs', 'mt-4 text-sm')} flex items-center gap-2 text-ink`}><LoaderCircle size={id ? 16 : 14} className="motion-safe:animate-spin" aria-hidden="true" />{approving ? 'Approving payment…' : 'Processing transaction…'}</p>}
        {operation.status === 'unknown' && <p role="status" className={`border-l-2 border-accent ${layout('mt-[9px] pl-2 text-xs', 'mt-4 pl-3 text-sm')}`}>We’re checking whether this payment went through. Don’t send it again.</p>}
        {operation.error && <p className={layout('mt-[9px] break-words text-xs', 'mt-4 break-words text-sm')}>{operation.error}</p>}
        {operation.status === 'pending_approval' && <div className={`flex flex-wrap ${layout('mt-3 gap-2', 'mt-6 gap-3')}`}><button className={`bg-black ${layout('px-3 py-2', 'px-5 py-3')} font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40`} disabled={decision.isPending || !asset} onClick={() => decision.mutate({ operation, approve: true })}>{decision.isPending ? 'Working…' : 'Approve payment'}</button><button className={`border border-beige-darker ${layout('px-3 py-2', 'px-5 py-3')} font-mono text-xs uppercase tracking-widest disabled:opacity-40`} disabled={decision.isPending} onClick={() => decision.mutate({ operation, approve: false })}>Decline</button></div>}
        <div className={layout('mt-2 flex flex-wrap items-start gap-x-4 gap-y-2', '')}>
          {explorer && <a href={explorer} target="_blank" rel="noreferrer" className={`inline-flex items-center underline underline-offset-4 ${layout('gap-1 text-xs', 'mt-5 gap-2 text-sm')}`}>View transaction <ArrowUpRight size={id ? 14 : 12} aria-hidden="true" /></a>}
          <details className={`text-xs text-ink-muted ${layout('min-w-0 flex-1', 'mt-5 border-t border-beige-darker pt-4')}`}><summary className="cursor-pointer whitespace-nowrap">Technical details</summary><p className="mt-2 break-all font-mono">Payment ID: {operation.id}<br />Approval hash: {operation.operationHash}<br />Asset: {operation.asset}</p>{operation.receipt && <pre className="mt-2 overflow-auto">{JSON.stringify(operation.receipt, null, 2)}</pre>}</details>
        </div>
      </article>
    })}
    {!id && (query.data?.length ?? 0) > visibleCount && <button type="button" className="border border-beige-darker px-4 py-2 font-mono text-xs text-ink hover:bg-beige-dark" onClick={() => setVisibleCount(count => count + 10)}>Show more</button>}
  </section>
}
